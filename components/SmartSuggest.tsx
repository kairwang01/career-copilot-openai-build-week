import React from 'react';
import { Sparkles } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartSuggestions {
  roles: string[];
  skills: string[];
}

// ─── Built-in skill dictionary (~80 terms) ────────────────────────────────────

const SKILL_DICTIONARY: string[] = [
  'React', 'TypeScript', 'JavaScript', 'Python', 'Java', 'Node.js', 'Go',
  'Rust', 'C++', 'C#', 'PHP', 'Ruby', 'Swift', 'Kotlin',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD',
  'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
  'GraphQL', 'REST', 'gRPC', 'Microservices', 'Linux', 'Git',
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch',
  'Data Analysis', 'Data Science', 'Statistics', 'R',
  'Figma', 'Sketch', 'Adobe XD', 'Illustrator', 'Photoshop',
  'HTML', 'CSS', 'Tailwind', 'Vue', 'Angular', 'Next.js',
  'Excel', 'Power BI', 'Tableau', 'Google Analytics',
  'Project Management', 'Agile', 'Scrum', 'Kanban', 'Jira',
  'Product Management', 'Roadmap', 'A/B Testing', 'User Research',
  'Communication', 'Leadership', 'Mentoring', 'Collaboration',
  'Marketing', 'SEO', 'Content Strategy', 'Copywriting',
  'Sales', 'CRM', 'HubSpot', 'Salesforce',
  'Finance', 'Accounting', 'Budgeting', 'Forecasting',
  'Security', 'DevSecOps', 'Penetration Testing', 'Compliance',
  'Spark', 'Kafka', 'Airflow', 'dbt',
];

// ─── Title-keyword patterns ────────────────────────────────────────────────────

const TITLE_KEYWORDS = [
  'Engineer',
  'Developer',
  'Manager',
  'Designer',
  'Analyst',
  'Scientist',
  'Consultant',
  'Lead',
  'Architect',
  'Specialist',
];

// ─── deriveSmartSuggestions ────────────────────────────────────────────────────

/**
 * Pure heuristic — zero AI calls.
 * - roles: scan each line for a title keyword; return up to 5 distinct trimmed
 *   lines that contain one (capped at 60 chars).
 * - skills: intersect SKILL_DICTIONARY case-insensitively against the full
 *   resume text; return up to 12 matches preserving dictionary casing.
 */
export function deriveSmartSuggestions(resumeText: string): SmartSuggestions {
  // ── roles ──────────────────────────────────────────────────────────────────
  const lines = resumeText.split(/\r?\n/);
  const seenRoles = new Set<string>();
  const roles: string[] = [];

  for (const rawLine of lines) {
    if (roles.length >= 5) break;
    const line = rawLine.trim();
    if (!line || line.length > 60) continue;
    const lower = line.toLowerCase();
    if (TITLE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) {
      const key = line.toLowerCase();
      if (!seenRoles.has(key)) {
        seenRoles.add(key);
        roles.push(line);
      }
    }
  }

  // ── skills ─────────────────────────────────────────────────────────────────
  const textLower = resumeText.toLowerCase();
  const skills: string[] = [];

  for (const term of SKILL_DICTIONARY) {
    if (skills.length >= 12) break;
    // Word-boundary-like check: ensure the match isn't part of a longer token.
    // Use a simple includes on lowercase — good enough for resume scanning.
    const termLower = term.toLowerCase();
    // Check for the term surrounded by non-alphanumeric chars (or start/end).
    const idx = textLower.indexOf(termLower);
    if (idx === -1) continue;
    const before = idx === 0 ? '' : textLower[idx - 1];
    const after =
      idx + termLower.length >= textLower.length
        ? ''
        : textLower[idx + termLower.length];
    const boundBefore = !before || /[^a-z0-9]/.test(before);
    const boundAfter = !after || /[^a-z0-9]/.test(after);
    if (boundBefore && boundAfter) {
      skills.push(term);
    }
  }

  return { roles, skills };
}

// ─── SmartSuggestChips ────────────────────────────────────────────────────────

interface SmartSuggestChipsProps {
  items: string[];
  onPick: (v: string) => void;
  label?: string;
  emptyHint?: string;
}

/**
 * A small labeled row of clickable pill chips.
 * Renders nothing when items is empty and no emptyHint is provided.
 * Dark-mode aware. No external dependencies beyond lucide-react.
 */
export const SmartSuggestChips: React.FC<SmartSuggestChipsProps> = ({
  items,
  onPick,
  label,
  emptyHint,
}) => {
  if (items.length === 0 && !emptyHint) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 dark:text-slate-500 mr-1 shrink-0">
          <Sparkles className="h-3 w-3" />
          {label}
        </span>
      )}

      {items.length === 0 && emptyHint ? (
        <span className="text-[11px] text-gray-400 dark:text-slate-500 italic">
          {emptyHint}
        </span>
      ) : (
        items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPick(item)}
            className="inline-flex items-center rounded-full border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-gray-700 dark:text-slate-300 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
          >
            {item}
          </button>
        ))
      )}
    </div>
  );
};
