using System.Windows;
using System.Windows.Threading;

namespace ZhyMdReader;

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
        new MainWindow(file).Show();
        Task.Run(FileAssociation.SyncMenuTextWithSystem);
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
