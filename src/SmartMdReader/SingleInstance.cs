using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;

namespace SmartMdReader;

/// <summary>
/// 单实例：第一个进程监听命名管道，之后启动的进程把要打开的文件转发过去后直接退出。
/// </summary>
internal static class SingleInstance
{
    private static readonly string Id = $"SmartMdReader.{Environment.UserName}.{Process.GetCurrentProcess().SessionId}";
    private static Mutex? _mutex;

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    /// <summary>成为主实例返回 true；已有主实例时返回 false。</summary>
    public static bool TryBecomePrimary()
    {
        _mutex = new Mutex(true, @"Local\" + Id, out var created);
        if (created)
            return true;
        _mutex.Dispose();
        _mutex = null;
        return false;
    }

    /// <summary>把文件交给主实例。主实例没有响应时返回 false，由调用方自己打开窗口。</summary>
    public static bool Forward(string? path)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", Id, PipeDirection.Out);
            client.Connect(3000);
            AllowSetForegroundWindow(-1);
            var bytes = Encoding.UTF8.GetBytes(path ?? "");
            client.Write(bytes);
            client.Flush();
            return true;
        }
        catch
        {
            return false;
        }
    }

    public static void Listen(Action<string?> onOpen)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(Id, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.CurrentUserOnly);
                    server.WaitForConnection();
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var text = reader.ReadToEnd();
                    onOpen(string.IsNullOrWhiteSpace(text) ? null : text);
                }
                catch
                {
                    Thread.Sleep(200);
                }
            }
        })
        {
            IsBackground = true,
            Name = "SmartMdReader.SingleInstance",
        };
        thread.Start();
    }
}
