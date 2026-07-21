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
