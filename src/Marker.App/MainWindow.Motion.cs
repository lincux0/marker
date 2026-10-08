using System.Numerics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Windows.System;

namespace Marker.App;

public sealed partial class MainWindow
{
    private bool _motionInitialized;

    private async void Shell_KeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs args)
    {
        if ((Native.GetKeyState(0x11) & 0x8000) == 0) return;
        var command = args.Key switch
        {
            VirtualKey.N => "new",
            VirtualKey.O => "open",
            VirtualKey.S => (Native.GetKeyState(0x10) & 0x8000) != 0 ? "saveAs" : "save",
            _ => null
        };
        if (command is not null)
        {
            args.Handled = true;
            await ExecuteDocumentCommandAsync(command);
        }
        else if (args.Key is VirtualKey.F or VirtualKey.H or VirtualKey.Z or VirtualKey.Y)
        {
            args.Handled = true;
            SendEditorCommand(args.Key switch { VirtualKey.F => "find", VirtualKey.H => "replace", VirtualKey.Z => "undo", _ => "redo" });
        }
    }

    private void Shell_Loaded(object sender, RoutedEventArgs e)
    {
        if (_motionInitialized) return;
        _motionInitialized = true;
        SettingsNotice.RegisterPropertyChangedCallback(TextBlock.TextProperty, (_, _) => UpdateSettingsNotice());
        UpdateSettingsNotice();
        AnimateEntrance(CommandRow);
    }

    private void UpdateSettingsNotice()
    {
        SettingsNotice.Visibility = string.IsNullOrWhiteSpace(SettingsNotice.Text) ? Visibility.Collapsed : Visibility.Visible;
        Layout();
    }

    private void AnimateEntrance(FrameworkElement element)
    {
        var visual = ElementCompositionPreview.GetElementVisual(element);
        visual.StopAnimation("Opacity");
        visual.StopAnimation("Scale");
        visual.Opacity = 1;
        visual.Scale = Vector3.One;
        if (EffectiveReducedMotion) return;
        var compositor = visual.Compositor;
        var opacity = compositor.CreateScalarKeyFrameAnimation();
        opacity.InsertKeyFrame(0, 0);
        opacity.InsertKeyFrame(1, 1);
        opacity.Duration = TimeSpan.FromMilliseconds(167);
        visual.StartAnimation("Opacity", opacity);
        var scale = compositor.CreateVector3KeyFrameAnimation();
        scale.InsertKeyFrame(0, new Vector3(0.985f, 0.985f, 1));
        scale.InsertKeyFrame(1, Vector3.One,
            compositor.CreateCubicBezierEasingFunction(new Vector2(0, 0), new Vector2(0, 1)));
        scale.Duration = TimeSpan.FromMilliseconds(250);
        visual.CenterPoint = new Vector3((float)element.ActualWidth / 2, (float)element.ActualHeight / 2, 0);
        visual.StartAnimation("Scale", scale);
    }

    internal void RefreshMotionPreferences()
    {
        if (!EffectiveReducedMotion) return;
        foreach (var element in new FrameworkElement[] { CommandRow, DocumentRow, AppearancePanel })
        {
            var visual = ElementCompositionPreview.GetElementVisual(element);
            visual.StopAnimation("Opacity");
            visual.StopAnimation("Scale");
            visual.Opacity = 1;
            visual.Scale = Vector3.One;
        }
    }
}
