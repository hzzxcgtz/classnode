import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';

type RemarkParserData = {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
};

/**
 * Safari 15 compatible subset of remark-gfm.
 *
 * remark-gfm 4 bundles mdast-util-gfm-autolink-literal 2, whose source has a
 * regular-expression lookbehind. Safari before 16.4 fails while parsing that
 * entire JavaScript chunk, before React can hydrate the classroom page.
 * Explicit Markdown links still work; tables, task lists, strikethrough and
 * footnotes are retained here without loading the incompatible autolink code.
 */
export default function remarkGfmCompat(this: { data(): RemarkParserData }): undefined {
  const data = this.data();
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);

  micromarkExtensions.push(
    gfmFootnote(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
  );
  fromMarkdownExtensions.push(
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
}
