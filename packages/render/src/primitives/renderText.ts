import * as P from '@react-pdf/primitives';
import { isNil } from '@react-pdf/fns';

import renderGlyphs from './renderGlyphs';
import parseColor from '../utils/parseColor';
import { Context } from '../types';
import { SafeTextNode, SafeNoteNode } from '@react-pdf/layout';
import {
  Attachment,
  AttributedString,
  DecorationLine,
  Paragraph,
  Rect,
  Run,
} from '@react-pdf/textkit';

const DEST_REGEXP = /^#.+/;

const isSrcId = (src: string) => src.match(DEST_REGEXP);

const renderAttachment = (ctx: Context, attachment: Attachment) => {
  const { xOffset = 0, yOffset = 0, width, height, image } = attachment;

  ctx.translate(-width + xOffset, -height + yOffset);

  ctx.image(image, 0, 0, {
    fit: [width, height],
    align: 'center',
    valign: 'bottom',
  });
};

const renderAttachments = (ctx: Context, run: Run, glyphs: Run['glyphs']) => {
  if (!glyphs) return;
  if (!run.positions) return;

  const font = run.attributes.font?.[0];
  if (!font) return;

  ctx.save();

  const space = font.glyphForCodePoint(0x20);
  const objectReplacement = font.glyphForCodePoint(0xfffc);

  let attachmentAdvance = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    const position = run.positions[i];
    const glyph = glyphs[i];

    attachmentAdvance += position.xAdvance || 0;

    if (glyph.id === objectReplacement.id && run.attributes.attachment) {
      ctx.translate(attachmentAdvance, position.yOffset || 0);
      renderAttachment(ctx, run.attributes.attachment);
      glyphs[i] = space;
      attachmentAdvance = 0;
    }
  }

  ctx.restore();
};

const renderRun = (ctx: Context, run: Run) => {
  if (!run.glyphs) return;
  if (!run.positions) return;

  const font = run.attributes.font?.[0];
  if (!font) return;

  const { fontSize, link } = run.attributes;
  const color = parseColor(run.attributes.color);
  const opacity = isNil(run.attributes.opacity)
    ? color.opacity
    : run.attributes.opacity;

  const { height = 0, descent = 0, xAdvance = 0 } = run;

  ctx.fillColor(color.value);
  ctx.fillOpacity(opacity);

  if (link) {
    if (isSrcId(link)) {
      ctx.goTo(0, -height - descent, xAdvance, height, link.slice(1));
    } else {
      ctx.link(0, -height - descent, xAdvance, height, link);
    }
  }

  // Copy glyphs to avoid mutating the original array
  const glyphs = [...run.glyphs];

  renderAttachments(ctx, run, glyphs);

  ctx.font(font.type === 'STANDARD' ? font.fullName : font, fontSize);

  try {
    renderGlyphs(ctx, glyphs, run.positions!, 0, 0);
  } catch (error) {
    console.log(error);
  }

  ctx.translate(xAdvance, 0);
};

const renderBackground = (
  ctx: Context,
  rect: Rect,
  backgroundColor: string,
) => {
  const color = parseColor(backgroundColor);

  ctx.save();
  ctx.fillOpacity(color.opacity);
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.fill(color.value);
  ctx.restore();
};

const renderDecorationLine = (ctx: Context, decorationLine: DecorationLine) => {
  ctx.save();
  ctx.lineWidth(decorationLine.rect.height);
  ctx.strokeOpacity(decorationLine.opacity);

  if (/dashed/.test(decorationLine.style)) {
    ctx.dash(3 * decorationLine.rect.height, {});
  } else if (/dotted/.test(decorationLine.style)) {
    ctx.dash(decorationLine.rect.height, {});
  }

  if (/wavy/.test(decorationLine.style)) {
    const dist = Math.max(2, decorationLine.rect.height);
    let step = 1.1 * dist;
    const stepCount = Math.floor(decorationLine.rect.width / (2 * step));

    // Adjust step to fill entire width
    const remainingWidth = decorationLine.rect.width - stepCount * 2 * step;
    const adjustment = remainingWidth / stepCount / 2;
    step += adjustment;

    const cp1y = decorationLine.rect.y + dist;
    const cp2y = decorationLine.rect.y - dist;
    let { x } = decorationLine.rect;

    ctx.moveTo(decorationLine.rect.x, decorationLine.rect.y);

    for (let i = 0; i < stepCount; i += 1) {
      ctx.bezierCurveTo(
        x + step,
        cp1y,
        x + step,
        cp2y,
        x + 2 * step,
        decorationLine.rect.y,
      );
      x += 2 * step;
    }
  } else {
    ctx.moveTo(decorationLine.rect.x, decorationLine.rect.y);
    ctx.lineTo(
      decorationLine.rect.x + decorationLine.rect.width,
      decorationLine.rect.y,
    );

    if (/double/.test(decorationLine.style)) {
      ctx.moveTo(
        decorationLine.rect.x,
        decorationLine.rect.y + decorationLine.rect.height * 2,
      );
      ctx.lineTo(
        decorationLine.rect.x + decorationLine.rect.width,
        decorationLine.rect.y + decorationLine.rect.height * 2,
      );
    }
  }

  ctx.stroke(decorationLine.color);
  ctx.restore();
};

const renderLine = (ctx: Context, line: AttributedString) => {
  if (!line.box) return;

  const lineAscent = line.ascent || 0;

  ctx.save();
  ctx.translate(line.box.x, line.box.y + lineAscent);

  for (let i = 0; i < line.runs.length; i += 1) {
    const run = line.runs[i];
    const isLastRun = i === line.runs.length - 1;

    if (run.attributes.backgroundColor) {
      const xAdvance = run.xAdvance ?? 0;
      const overflowRight = isLastRun ? line.overflowRight ?? 0 : 0;

      const backgroundRect = {
        x: 0,
        y: -lineAscent,
        height: line.box.height,
        width: xAdvance - overflowRight,
      };

      renderBackground(ctx, backgroundRect, run.attributes.backgroundColor);
    }
    renderRun(ctx, run);
  }

  ctx.restore();
  ctx.save();
  ctx.translate(line.box.x, line.box.y);

  if (line.decorationLines) {
    for (let i = 0; i < line.decorationLines.length; i += 1) {
      const decorationLine = line.decorationLines[i];
      renderDecorationLine(ctx, decorationLine);
    }
  }

  ctx.restore();
};

const renderBlock = (ctx: Context, block: Paragraph) => {
  block.forEach((line) => {
    renderLine(ctx, line);
  });
};

type NoteWithCharIndex = {
  note: SafeNoteNode;
  charIndex: number;
};

/**
 * Recursively collect Note nodes along with their character index in the
 * flattened text. The charIndex indicates where the Note's parent Text
 * content starts in the attributed string.
 */
const collectNotesWithCharIndex = (
  children: SafeTextNode['children'],
  charIndex = 0,
): { notes: NoteWithCharIndex[]; charIndex: number } => {
  const notes: NoteWithCharIndex[] = [];
  if (!children) return { notes, charIndex };

  let currentIndex = charIndex;

  for (const child of children) {
    if (child.type === P.Note) {
      // Record the Note with its current character position
      notes.push({ note: child as SafeNoteNode, charIndex: currentIndex });
    } else if (child.type === P.TextInstance) {
      // Text content advances the character index
      currentIndex += (child as any).value?.length || 0;
    } else if (child.type === P.Image) {
      // Images take 1 character (object replacement char)
      currentIndex += 1;
    } else if ('children' in child && child.children) {
      // Recurse into nested Text nodes
      const result = collectNotesWithCharIndex(
        child.children as SafeTextNode['children'],
        currentIndex,
      );
      notes.push(...result.notes);
      currentIndex = result.charIndex;
    }
  }

  return { notes, charIndex: currentIndex };
};

const renderText = (ctx: Context, node: SafeTextNode) => {
  if (!node.box) return;
  if (!node.lines) return;

  const { top, left } = node.box;
  const blocks = [node.lines];
  const paddingTop = node.box?.paddingTop || 0;
  const paddingLeft = node.box?.paddingLeft || 0;
  const initialY = node.lines[0] ? node.lines[0].box!.y : 0;
  const offsetX = node.alignOffset || 0;

  ctx.save();
  ctx.translate(left + paddingLeft - offsetX, top + paddingTop - initialY);

  blocks.forEach((block) => {
    renderBlock(ctx, block);
  });

  // Render any Note children embedded inside this Text node.
  // Notes are positioned at the start of their parent Text's content.
  // We track character indices to map Notes to their rendered positions.
  const { notes: notesWithIndex } = collectNotesWithCharIndex(node.children);
  if (notesWithIndex.length > 0) {
    const NOTE_SIZE = 16;

    // Helper to find X,Y position for a character index
    // Run indices reset per line, so we track a cumulative offset
    const findPositionForCharIndex = (
      targetIndex: number,
    ): { x: number; y: number } | null => {
      let globalOffset = 0;
      for (const line of node.lines) {
        if (!line.box) continue;
        // Get the line's character range
        const lineStart = globalOffset;
        const lineEnd =
          globalOffset + (line.runs[line.runs.length - 1]?.end ?? 0);

        if (targetIndex >= lineStart && targetIndex < lineEnd) {
          // Target is in this line - find the run
          const localIndex = targetIndex - globalOffset;
          let runX = line.box.x;
          for (const run of line.runs) {
            const runStart = run.start ?? 0;
            const runEnd = run.end ?? runStart;
            if (localIndex >= runStart && localIndex < runEnd) {
              // Found the run containing this character
              const charOffset = localIndex - runStart;
              let xOffset = 0;
              if (run.positions && charOffset > 0) {
                for (
                  let i = 0;
                  i < charOffset && i < run.positions.length;
                  i++
                ) {
                  xOffset += run.positions[i].xAdvance || 0;
                }
              }
              return { x: runX + xOffset, y: line.box.y };
            }
            runX += run.xAdvance || 0;
          }
        }
        // Advance global offset by the line's character count
        globalOffset = lineEnd;
      }
      return null;
    };

    for (const { note, charIndex } of notesWithIndex) {
      const value = note.children?.[0]?.value || '';
      const color = note.style?.backgroundColor;

      // Find position for this character index, or fall back to origin
      const pos = findPositionForCharIndex(charIndex) || {
        x: offsetX,
        y: initialY,
      };
      ctx.note(pos.x, pos.y, NOTE_SIZE, NOTE_SIZE, value, {
        color,
      });
    }
  }

  ctx.restore();
};

export default renderText;
