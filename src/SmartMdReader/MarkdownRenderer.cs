using System.Globalization;
using System.IO;
using Markdig;
using Markdig.Extensions.AutoIdentifiers;
using Markdig.Renderers;
using Markdig.Renderers.Html;
using Markdig.Syntax;

namespace SmartMdReader;

internal static class MarkdownRenderer
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAutoIdentifiers(AutoIdentifierOptions.GitHub)
        .UseAdvancedExtensions()
        .UseEmojiAndSmiley(enableSmileys: false)
        .UseYamlFrontMatter()
        .Build();

    /// <summary>渲染 HTML，并给每个块元素加上 data-line（源码行号，从 0 开始），用于分屏时同步滚动。</summary>
    public static string ToHtml(string markdown)
    {
        var document = Markdown.Parse(markdown, Pipeline);
        foreach (var block in document.Descendants<Block>())
            block.GetAttributes().AddProperty("data-line", block.Line.ToString(CultureInfo.InvariantCulture));

        using var writer = new StringWriter();
        var renderer = new HtmlRenderer(writer);
        Pipeline.Setup(renderer);
        renderer.Render(document);
        writer.Flush();
        return writer.ToString();
    }
}
