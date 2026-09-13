// Plain text from the markup that findings and wiki articles use (rendered by components/ui/RichText.tsx):
//   **bold**  _italic_  ==highlight==  ++good++  !!bad!!  [[article-id|label]]
export function stripMarkup(markup: string): string {
  return markup
    .replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\*\*|==|\+\+|!!/g, "")
    .replace(/(?<![\w])_([^_]+)_(?![\w])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
