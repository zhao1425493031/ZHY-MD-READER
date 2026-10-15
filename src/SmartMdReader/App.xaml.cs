using System.Windows;
using System.Windows.Threading;

namespace SmartMdReader;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnUnhandledException;
        Loc.SetLanguage(AppSettings.Load().Language);

        var args = e.Args;
        var quiet = args.Contains("--quiet", StringComparer.OrdinalIgnoreCase);

        if (args.Contains("--register", StringComparer.OrdinalIgnoreCase))
        {
            RunAndExit(() => FileAssociation.Register(Environment.ProcessPath!), Loc.T("app.registered"), quiet);
            return;
        }

        if (args.Contains("--unregister", StringComparer.OrdinalIgnoreCase))
        {
            RunAndExit(FileAssociation.Unregister, Loc.T("app.unregistered"), quiet);
            return;
        }

        var file = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal));
        if (file is not null)
        {
            try { file = System.IO.Path.GetFullPath(file); } catch { }
        }

        var newWindow = args.Contains("--new-window", StringComparer.OrdinalIgnoreCase);
        if (!newWindow && !SingleInstance.TryBecomePrimary())
        {
            if (SingleInstance.Forward(file))
            {
                Shutdown(0);
                return;
            }
        }
        else if (!newWindow)
        {
            SingleInstance.Listen(path => Dispatcher.BeginInvoke(() => OpenInExistingWindow(path)));
        }

        new MainWindow(file).Show();
        Task.Run(FileAssociation.SyncMenuTextWithSystem);
    }

    private void OpenInExistingWindow(string? path)
    {
        var windows = Windows.OfType<MainWindow>().ToList();
        var target = windows.FirstOrDefault(w => w.IsActive) ?? windows.LastOrDefault();
        if (target is null)
        {
            new MainWindow(path).Show();
            return;
        }
        target.OpenFromOtherInstance(path);
    }

    private void RunAndExit(Action action, string successMessage, bool quiet)
    {
        try
        {
            action();
            if (!quiet)
                MessageBox.Show(successMessage, AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown(0);
        }
        catch (Exception ex)
        {
            if (!quiet)
                MessageBox.Show(ex.Message, AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private static void OnUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show(e.Exception.Message, AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }
}
