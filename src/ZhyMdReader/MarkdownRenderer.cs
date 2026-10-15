using Markdig;
using Markdig.Extensions.AutoIdentifiers;

namespace ZhyMdReader;

internal static class MarkdownRenderer
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAutoIdentifiers(AutoIdentifierOptions.GitHub)
        .UseAdvancedExtensions()
        .UseEmojiAndSmiley(enableSmileys: false)
        .UseYamlFrontMatter()
        .Build();

    public static string ToHtml(string markdown) => Markdown.ToHtml(markdown, Pipeline);
}
