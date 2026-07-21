import { describe, expect, it } from 'vitest';
import {
  normalizeTalentProfile,
  redactTalentDiscoveryText,
  talentProfileToDiscoveryContext,
} from '../functions/src/utils/talentProfile';

const PRIVATE_VALUES = [
  'Casey Confidential',
  'casey.private@example.com',
  '+1 (613) 555-0100',
  'Private Robotics Ltd',
  'Secret University',
  'https://casey-private.example/portfolio',
];

const rawProfile = {
  status: 'complete',
  discoverable: true,
  basic: {
    name: PRIVATE_VALUES[0],
    email: PRIVATE_VALUES[1],
    phone: PRIVATE_VALUES[2],
    city: 'Ottawa',
  },
  intention: {
    targetRole: 'Product Engineer',
    acceptRelocation: 'Yes',
  },
  education: [{
    school: PRIVATE_VALUES[4],
    degree: 'Bachelor of Engineering',
    major: 'Software Engineering',
    thesis: `Built a React research platform at ${PRIVATE_VALUES[4]}.`,
  }],
  experience: [{
    company: PRIVATE_VALUES[3],
    role: 'Software Engineer',
    tools: ['React', 'TypeScript', 'Python'],
    workContent: `Casey Confidential built React systems at Private Robotics Ltd. Contact ${PRIVATE_VALUES[1]} or ${PRIVATE_VALUES[2]}.`,
    outcome: `Published delivery notes at ${PRIVATE_VALUES[5]}.`,
  }],
  projects: [{
    name: 'Private Marketplace Project',
    role: 'Technical Lead',
    link: PRIVATE_VALUES[5],
    responsibilities: 'Designed TypeScript services and accessible React workflows.',
  }],
  skills: {
    technical: ['React', 'TypeScript', 'Python'],
    product: ['Product discovery'],
  },
  portfolio: [{
    name: 'Private portfolio',
    url: PRIVATE_VALUES[5],
    description: 'Personal work samples',
  }],
  additional: {
    overallStrengths: 'Cross-functional product delivery with React and TypeScript.',
  },
};

describe('talent discovery privacy context', () => {
  it('keeps job-relevant skills while removing candidate and organization identifiers', () => {
    const profile = normalizeTalentProfile(rawProfile);
    const context = talentProfileToDiscoveryContext(profile);
    const lower = context.text.toLowerCase();

    expect(context.text).toContain('React');
    expect(context.text).toContain('TypeScript');
    expect(context.text).toContain('Product Engineer');
    for (const value of PRIVATE_VALUES) {
      expect(lower).not.toContain(value.toLowerCase());
    }
  });

  it('redacts contact patterns and candidate-specific terms from model output too', () => {
    const profile = normalizeTalentProfile(rawProfile);
    const context = talentProfileToDiscoveryContext(profile);
    const result = redactTalentDiscoveryText(
      `Casey Confidential at Private Robotics Ltd is strong in React. Email ${PRIVATE_VALUES[1]}, call ${PRIVATE_VALUES[2]}, or visit ${PRIVATE_VALUES[5]}.`,
      context.sensitiveTerms,
    );
    const lower = result.toLowerCase();

    expect(result).toContain('React');
    for (const value of PRIVATE_VALUES) {
      expect(lower).not.toContain(value.toLowerCase());
    }
  });

  it('redacts short multilingual names without corrupting longer ASCII words', () => {
    const profile = normalizeTalentProfile({
      ...rawProfile,
      basic: { ...rawProfile.basic, name: 'Al', preferredName: '李雷' },
      experience: [{
        ...rawProfile.experience[0],
        workContent: 'Al and 李雷 use Algolia to build accessible products.',
      }],
    });
    const context = talentProfileToDiscoveryContext(profile);

    expect(context.text).not.toMatch(/\bAl\b/i);
    expect(context.text).not.toContain('李雷');
    expect(context.text).toContain('Algolia');
  });

  it('keeps every bounded sensitive term instead of leaking identifiers after 160 entries', () => {
    const numbered = (prefix: string, count: number, keys: string[]) => Array.from(
      { length: count },
      (_, row) => Object.fromEntries(keys.map((key, column) => [
        key,
        `${prefix}-${String(row).padStart(2, '0')}-${String(column).padStart(2, '0')}-private`,
      ])),
    );
    const tailIdentifier = '尾部识别';
    const profile = normalizeTalentProfile({
      ...rawProfile,
      education: numbered('education', 8, ['school', 'location', 'gpa', 'gpaScale', 'ranking']),
      experience: numbered('experience', 8, ['company', 'location', 'role']),
      projects: numbered('project', 8, ['name', 'link', 'role']),
      awards: numbered('award', 8, ['name', 'type', 'date', 'organization', 'description']),
      portfolio: numbered('portfolio', 8, ['name', 'type', 'url', 'description']),
      references: [
        ...numbered('reference', 7, ['identity', 'relationship', 'organization']),
        { identity: 'tail-identity-private', relationship: 'tail-relation-private', organization: tailIdentifier },
      ],
      additional: {
        overallStrengths: `Delivered private programs with ${tailIdentifier}.`,
      },
    });
    const context = talentProfileToDiscoveryContext(profile);

    expect(context.sensitiveTerms.length).toBeGreaterThan(160);
    expect(context.sensitiveTerms).toContain(tailIdentifier);
    expect(context.text).not.toContain(tailIdentifier);
  });

  it('fails closed for draft or non-discoverable profiles', () => {
    const hidden = normalizeTalentProfile({ ...rawProfile, discoverable: false });
    const draft = normalizeTalentProfile({ ...rawProfile, status: 'draft' });

    expect(talentProfileToDiscoveryContext(hidden).text).toBe('');
    expect(talentProfileToDiscoveryContext(draft).text).toBe('');
  });
});
