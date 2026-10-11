using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Marker.App;

internal static class SettingsDatabase
{
    private const int DatabaseSchemaVersion = 1;
    private const string DatabaseFileName = "settings.db";
    private const string JournalSuffix = "-journal";

    internal static AppSettingsLoadResult Load(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        var fullDirectory = Path.GetFullPath(directory);
        var databasePath = Path.Combine(fullDirectory, DatabaseFileName);
        try
        {
            CheckSafePaths(fullDirectory, databasePath);
            if (File.Exists(databasePath)) return ReadExisting(databasePath);

            var legacy = AppSettings.Load(fullDirectory);
            var settings = legacy.CanSave ? legacy.Settings : AppSettings.Default;
            Save(fullDirectory, settings);
            return new(settings,
                legacy.CanSave ? legacy.Warning : "旧设置文件无法读取或版本不兼容，已保留原文件并改用默认设置。",
                true);
        }
        catch (Exception error) when (IsStorageError(error))
        {
            return new(AppSettings.Default,
                $"设置数据库“{databasePath}”无法安全读取或写入，当前修改仅在本次运行中生效（诊断：{DescribeStorageError(error)}）。", false);
        }
    }

    internal static AppSettingsLoadResult LoadWithPendingChanges(string directory, AppSettings baseline, AppSettings pending)
    {
        ArgumentNullException.ThrowIfNull(baseline);
        ArgumentNullException.ThrowIfNull(pending);

        var loaded = Load(directory);
        if (!loaded.CanSave) return loaded;

        var baselineJson = JsonNode.Parse(baseline.Serialize())!.AsObject();
        var pendingJson = JsonNode.Parse(pending.Serialize())!.AsObject();
        var mergedJson = JsonNode.Parse(loaded.Settings.Serialize())!.AsObject();
        foreach (var (name, value) in pendingJson)
        {
            if (!JsonNode.DeepEquals(baselineJson[name], value))
                mergedJson[name] = value?.DeepClone();
        }

        var merged = AppSettings.ParseSerialized(JsonSerializer.SerializeToUtf8Bytes(mergedJson));
        return merged.CanSave ? merged with { Warning = loaded.Warning ?? merged.Warning } : loaded;
    }

    internal static void Save(string directory, AppSettings settings)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        ArgumentNullException.ThrowIfNull(settings);
        settings.ValidateForSave();

        var fullDirectory = Path.GetFullPath(directory);
        DocumentFile.RejectReparsePath(fullDirectory, includeTarget: false);
        Directory.CreateDirectory(fullDirectory);
        DocumentFile.RejectReparsePath(fullDirectory, includeTarget: true);
        var databasePath = Path.Combine(fullDirectory, DatabaseFileName);
        CheckSafePaths(fullDirectory, databasePath);
        var existed = File.Exists(databasePath);
        if (existed && new FileInfo(databasePath).Length == 0)
            throw new InvalidDataException("设置数据库为空，未覆盖原文件。");

        using var connection = Open(databasePath);
        if (existed)
        {
            ValidateSchema(connection);
            EnsureDeleteJournal(connection);
        }
        else
        {
            EnsureDeleteJournal(connection);
            using var transaction = connection.BeginTransaction();
            Execute(connection, transaction, "CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, payload TEXT NOT NULL)");
            Execute(connection, transaction, $"PRAGMA user_version = {DatabaseSchemaVersion}");
            WriteRow(connection, transaction, settings);
            transaction.Commit();
        }
        CheckSafePaths(fullDirectory, databasePath);

        if (existed)
        {
            using var transaction = connection.BeginTransaction();
            WriteRow(connection, transaction, settings);
            transaction.Commit();
        }
    }

    private static AppSettingsLoadResult ReadExisting(string databasePath)
    {
        using var connection = Open(databasePath, readOnly: true);
        ValidateSchema(connection);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT schema_version, payload FROM settings WHERE id = 1";
        using var reader = command.ExecuteReader();
        if (!reader.Read() || reader.GetInt32(0) != AppSettings.CurrentSchemaVersion || reader.IsDBNull(1))
            throw new InvalidDataException("设置数据库记录无效。");
        var payload = reader.GetString(1);
        if (Encoding.UTF8.GetByteCount(payload) > AppSettings.MaxSerializedBytes || reader.Read())
            throw new InvalidDataException("设置数据库记录无效或超过 64 KiB。");

        var parsed = AppSettings.ParseSerialized(Encoding.UTF8.GetBytes(payload));
        if (!parsed.CanSave) throw new InvalidDataException(parsed.Warning ?? "设置数据库中的内容无法读取。");
        return parsed;
    }

    private static void ValidateSchema(SqliteConnection connection)
    {
        using var version = connection.CreateCommand();
        version.CommandText = "SELECT user_version FROM pragma_user_version()";
        if (version.ExecuteScalar() is not long actualVersion)
            throw new InvalidDataException("设置数据库版本查询没有返回有效整数，已保留原文件。");
        if (actualVersion != DatabaseSchemaVersion)
            throw new InvalidDataException($"设置数据库版本 {actualVersion} 不兼容，已保留原文件。");

        using var row = connection.CreateCommand();
        row.CommandText = "SELECT COUNT(*), MAX(CASE WHEN id = 1 AND schema_version = $schema AND typeof(schema_version) = 'integer' THEN 1 ELSE 0 END) FROM settings";
        row.Parameters.AddWithValue("$schema", AppSettings.CurrentSchemaVersion);
        using var reader = row.ExecuteReader();
        if (!reader.Read() || reader.GetInt64(0) != 1 || reader.GetInt64(1) != 1)
            throw new InvalidDataException("设置数据库记录或版本无效，已保留原文件。");
    }

    private static SqliteConnection Open(string databasePath, bool readOnly = false)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = 3
        }.ToString());
        try
        {
            connection.Open();
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private static void EnsureDeleteJournal(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode = DELETE";
        if (!string.Equals(Convert.ToString(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture), "delete", StringComparison.OrdinalIgnoreCase))
            throw new IOException("无法启用 SQLite 回滚日志模式。");
    }

    private static void WriteRow(SqliteConnection connection, SqliteTransaction transaction, AppSettings settings)
    {
        var payload = settings.Serialize();
        if (payload.Length > AppSettings.MaxSerializedBytes)
            throw new ArgumentException("设置内容超过 64 KiB，未保存。", nameof(settings));
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO settings (id, schema_version, payload) VALUES (1, $schema, $payload) ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, payload = excluded.payload";
        command.Parameters.AddWithValue("$schema", AppSettings.CurrentSchemaVersion);
        command.Parameters.Add("$payload", SqliteType.Text).Value = Encoding.UTF8.GetString(payload);
        command.ExecuteNonQuery();
    }

    private static void Execute(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static void CheckSafePaths(string directory, string databasePath)
    {
        DocumentFile.RejectReparsePath(directory, includeTarget: true);
        DocumentFile.RejectReparsePath(databasePath, includeTarget: true);
        DocumentFile.RejectReparsePath(databasePath + JournalSuffix, includeTarget: true);
        DocumentFile.RejectReparsePath(databasePath + "-wal", includeTarget: true);
        DocumentFile.RejectReparsePath(databasePath + "-shm", includeTarget: true);
    }

    private static bool IsStorageError(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException
        or ArgumentException or InvalidOperationException or SqliteException;

    private static string DescribeStorageError(Exception error) => error switch
    {
        SqliteException sqlite => $"SQLite {sqlite.SqliteErrorCode}/{sqlite.SqliteExtendedErrorCode}",
        InvalidDataException invalidData => invalidData.Message,
        _ => error.GetType().Name
    };
}
