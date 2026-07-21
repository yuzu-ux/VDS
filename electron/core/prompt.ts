// Prompt composition, the equivalent of Open Design's daemon-side composer:
// core contract + skill + design system + fidelity + project state + request.
// Big resources stay on disk (.uio/skill, .uio/DESIGN.md) and are referenced,
// because every supported runtime is a coding agent with file tools.
import type { ElementComment, Fidelity, ProjectMeta, SkillInfo } from '../../shared/types';

export function composeTurnPrompt(opts: {
  project: ProjectMeta;
  skill: SkillInfo;
  hasDesignSystem: boolean;
  isFirstTurn: boolean;
  userPrompt: string;
  comments?: ElementComment[];
}): string {
  const { project, skill, hasDesignSystem, isFirstTurn, userPrompt, comments } = opts;
  const parts: string[] = [];

  parts.push(
    `# UIO design run

You are the design engine inside UIO, an open-source design studio. Your working directory is the project workspace — create and edit files here only.

## Skill
Read \`.uio/skill/SKILL.md\` now and follow it exactly. Its \`assets/\` and \`references/\` live next to it inside \`.uio/skill/\`. The canonical deliverable is \`${skill.entry}\` in the workspace root.`,
  );

  parts.push(
    hasDesignSystem
      ? `## Design system
The active brand contract is \`.uio/DESIGN.md\`. Read it and obey its tokens — colors, typography, spacing, and rules — over any conflicting default in the skill.`
      : `## Design system
None — freeform. Choose one tasteful, coherent direction yourself and hold it consistently.`,
  );

  parts.push(fidelityClause(project.fidelity));

  if (isFirstTurn) {
    parts.push(
      `## First turn
Before building, reply with one short paragraph naming 3 candidate design directions (name — palette hint — vibe, one line each) and say which you are taking and why. If the brief is genuinely ambiguous on something that changes the whole design (audience, content, purpose), ask at most 3 crisp questions and stop; otherwise proceed immediately. Do not wait for approval of the direction.`,
    );
  } else {
    parts.push(
      `## Follow-up turn
The workspace already contains the current design. Read \`${skill.entry}\` before editing and apply the requested changes surgically — do not regenerate from scratch unless asked.`,
    );
  }

  parts.push(
    `## Output contract
Write real files. End with one short summary of what you built or changed. Never print file contents into chat. Keep \`${skill.entry}\` fully self-contained (inline CSS/JS, no external URLs; use placeholder blocks for imagery). Put \`data-uio-id\` attributes on top-level sections so elements can be targeted by comments.`,
  );

  const commentBlock = renderComments(comments);
  parts.push(`## Request\n${userPrompt.trim()}${commentBlock}`);

  return parts.join('\n\n');
}

function fidelityClause(fidelity: Fidelity): string {
  return fidelity === 'wireframe'
    ? `## Fidelity
Wireframe: grayscale only, boxes, real information architecture and real copy hierarchy, no decorative styling. Speed over polish.`
    : `## Fidelity
High fidelity: production-grade visual quality. Typography, spacing, and restraint are the craft — a single accent color used sparingly beats many.`;
}

function renderComments(comments?: ElementComment[]): string {
  if (!comments || comments.length === 0) return '';
  const lines = comments.map(
    (c) => `- On \`${c.selector}\`${c.elementLabel ? ` (${c.elementLabel})` : ''}: ${c.note}`,
  );
  return `\n\n### Inline comments pinned to elements\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Direct-API / hosted profile: the model has no file tools, so the seed and
// design tokens are inlined and the deliverable comes back as one <artifact>.

export function composeProviderPrompt(opts: {
  skill: SkillInfo;
  seedHtml: string;
  designSystemContract: string | null;
  fidelity: Fidelity;
  isFirstTurn: boolean;
  currentFileContent: string | null;
  userPrompt: string;
  comments?: ElementComment[];
}): { system: string; user: string } {
  const { skill, seedHtml, designSystemContract, fidelity, isFirstTurn, currentFileContent, userPrompt, comments } = opts;
  const kind = skill.mode === 'deck' ? 'slide deck' : 'web page';

  const system = [
    `You are the design engine inside UIO, an open-source design studio. You produce one polished, self-contained ${kind} as a single HTML document.`,
    fidelityClause(fidelity).replace(/^## Fidelity\n/, 'Fidelity — '),
    `Craft rules:
- Compose from the provided seed; keep its token system and class names. Map the design system's colors onto the seed's :root variables.
- ${skill.mode === 'deck' ? 'One <section class="slide"> per slide; keep the seed navigation and print CSS.' : 'Real information architecture and real copy from the brief — no lorem ipsum, no [placeholder] strings.'}
- Fully self-contained: inline all CSS/JS, no external URLs, no web fonts, no remote images (use the seed's placeholder blocks).
- Put data-uio-id on every top-level ${skill.mode === 'deck' ? 'slide' : 'section'} so elements can be targeted by comments.
- Single accent color, used sparingly.`,
    `OUTPUT CONTRACT — obey exactly:
Return your final document as ONE block:
<artifact identifier="${skill.mode === 'deck' ? 'deck' : 'index'}" type="text/html" title="...">
<!doctype html> … full document … </html>
</artifact>
Before the block, write at most 2 short sentences: the direction you chose and why. After the block, write nothing. Do not describe the code or paste it twice. There are no file tools — the artifact block IS the deliverable.`,
  ].join('\n\n');

  const parts: string[] = [];
  parts.push(`## Brief\n${userPrompt.trim()}`);
  parts.push(
    designSystemContract
      ? `## Design system (obey these tokens)\n${clip(designSystemContract, 2400)}`
      : `## Design system\nNone — freeform. Choose one tasteful, coherent direction and hold it.`,
  );
  if (currentFileContent) {
    parts.push(
      `## Current document (edit this — do not start from scratch)\nApply the requested changes to the document below and return the full updated document in the artifact block.\n\n\`\`\`html\n${clip(currentFileContent, 14000)}\n\`\`\``,
    );
  } else {
    parts.push(`## Seed to compose from\n\`\`\`html\n${clip(seedHtml, 9000)}\n\`\`\``);
  }
  if (isFirstTurn && !currentFileContent) {
    parts.push(`## Note\nThis is the first version. Commit to one direction and build it fully now — do not ask for approval first.`);
  }
  const commentBlock = renderComments(comments);
  if (commentBlock) parts.push(commentBlock.trim());

  return { system, user: parts.join('\n\n') };
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '\n<!-- …truncated… -->' : text;
}
