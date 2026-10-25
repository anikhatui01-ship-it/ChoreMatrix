/**
 * Household Member Color System
 *
 * Deterministic, accessible color palette for household members in Weekly Schedule & Assignments view.
 * Ensures every member in a household has a distinct, visually recognizable color that remains
 * stable across calendar and table views, week navigation, rebalances, and refreshes.
 */

export interface ColorTokens {
  text: string;
  bg: string;
  border: string;
  accent: string;
}

export interface MemberColorDef {
  index: number;
  name: string;
  light: ColorTokens;
  dark: ColorTokens;
}

export interface MemberColorInstance {
  index: number;
  name: string;
  className: string;
  cssVars: string;
  light: ColorTokens;
  dark: ColorTokens;
  current: ColorTokens;
}

export interface MemberLike {
  id?: string;
  memberId?: string;
  name?: string;
  memberName?: string;
  colorIndex?: number;
}

/**
 * 10 primary curated color schemes with high contrast in both dark and light modes.
 * Designed to avoid confusion with:
 * - Yellow/amber conflict warning (#f59e0b)
 * - Red alert/unassigned errors (#D65C5C)
 * - Purple "Edited" tag (var(--accent-light))
 */
export const MEMBER_PRIMARY_PALETTE: Omit<MemberColorDef, 'index'>[] = [
  {
    name: 'sky',
    light: {
      text: '#0369a1',
      bg: 'rgba(2, 132, 199, 0.12)',
      border: 'rgba(2, 132, 199, 0.40)',
      accent: '#0284c7'
    },
    dark: {
      text: '#38bdf8',
      bg: 'rgba(56, 189, 248, 0.16)',
      border: 'rgba(56, 189, 248, 0.45)',
      accent: '#38bdf8'
    }
  },
  {
    name: 'emerald',
    light: {
      text: '#047857',
      bg: 'rgba(5, 150, 105, 0.12)',
      border: 'rgba(5, 150, 105, 0.40)',
      accent: '#059669'
    },
    dark: {
      text: '#34d399',
      bg: 'rgba(52, 211, 153, 0.16)',
      border: 'rgba(52, 211, 153, 0.45)',
      accent: '#34d399'
    }
  },
  {
    name: 'violet',
    light: {
      text: '#7e22ce',
      bg: 'rgba(147, 51, 234, 0.12)',
      border: 'rgba(147, 51, 234, 0.40)',
      accent: '#9333ea'
    },
    dark: {
      text: '#c084fc',
      bg: 'rgba(192, 132, 252, 0.16)',
      border: 'rgba(192, 132, 252, 0.45)',
      accent: '#c084fc'
    }
  },
  {
    name: 'coral',
    light: {
      text: '#c2410c',
      bg: 'rgba(234, 88, 12, 0.12)',
      border: 'rgba(234, 88, 12, 0.40)',
      accent: '#ea580c'
    },
    dark: {
      text: '#fb923c',
      bg: 'rgba(251, 146, 60, 0.16)',
      border: 'rgba(251, 146, 60, 0.45)',
      accent: '#fb923c'
    }
  },
  {
    name: 'rose',
    light: {
      text: '#be185d',
      bg: 'rgba(219, 39, 119, 0.12)',
      border: 'rgba(219, 39, 119, 0.40)',
      accent: '#db2777'
    },
    dark: {
      text: '#f472b6',
      bg: 'rgba(244, 114, 182, 0.16)',
      border: 'rgba(244, 114, 182, 0.45)',
      accent: '#f472b6'
    }
  },
  {
    name: 'teal',
    light: {
      text: '#0f766e',
      bg: 'rgba(13, 148, 136, 0.12)',
      border: 'rgba(13, 148, 136, 0.40)',
      accent: '#0d9488'
    },
    dark: {
      text: '#2dd4bf',
      bg: 'rgba(45, 212, 191, 0.16)',
      border: 'rgba(45, 212, 191, 0.45)',
      accent: '#2dd4bf'
    }
  },
  {
    name: 'indigo',
    light: {
      text: '#4338ca',
      bg: 'rgba(79, 70, 229, 0.12)',
      border: 'rgba(79, 70, 229, 0.40)',
      accent: '#4f46e5'
    },
    dark: {
      text: '#a5b4fc',
      bg: 'rgba(165, 180, 252, 0.16)',
      border: 'rgba(165, 180, 252, 0.45)',
      accent: '#818cf8'
    }
  },
  {
    name: 'amber',
    light: {
      text: '#a16207',
      bg: 'rgba(202, 138, 4, 0.12)',
      border: 'rgba(202, 138, 4, 0.40)',
      accent: '#ca8a04'
    },
    dark: {
      text: '#fde047',
      bg: 'rgba(253, 224, 71, 0.16)',
      border: 'rgba(253, 224, 71, 0.45)',
      accent: '#eab308'
    }
  },
  {
    name: 'blue',
    light: {
      text: '#1d4ed8',
      bg: 'rgba(37, 99, 235, 0.12)',
      border: 'rgba(37, 99, 235, 0.40)',
      accent: '#2563eb'
    },
    dark: {
      text: '#60a5fa',
      bg: 'rgba(96, 165, 250, 0.16)',
      border: 'rgba(96, 165, 250, 0.45)',
      accent: '#3b82f6'
    }
  },
  {
    name: 'lime',
    light: {
      text: '#4d7c0f',
      bg: 'rgba(101, 163, 13, 0.12)',
      border: 'rgba(101, 163, 13, 0.40)',
      accent: '#65a30d'
    },
    dark: {
      text: '#a3e635',
      bg: 'rgba(163, 230, 53, 0.16)',
      border: 'rgba(163, 230, 53, 0.45)',
      accent: '#84cc16'
    }
  }
];

/**
 * Returns color definition for any non-negative index.
 * For index >= 10, generates golden-angle HSL colors to ensure visual distinctiveness.
 */
export function getMemberColorDef(index: number): MemberColorDef {
  const safeIndex = Math.max(0, Math.floor(index));
  if (safeIndex < MEMBER_PRIMARY_PALETTE.length) {
    return {
      index: safeIndex,
      ...MEMBER_PRIMARY_PALETTE[safeIndex]
    };
  }

  // Golden-angle hue progression (137.508 degrees) gives maximally separated hues
  const hue = Math.round((safeIndex * 137.508) % 360);
  return {
    index: safeIndex,
    name: `color-${safeIndex}`,
    light: {
      text: `hsl(${hue}, 85%, 28%)`,
      bg: `hsla(${hue}, 85%, 45%, 0.12)`,
      border: `hsla(${hue}, 85%, 45%, 0.40)`,
      accent: `hsl(${hue}, 85%, 35%)`
    },
    dark: {
      text: `hsl(${hue}, 80%, 72%)`,
      bg: `hsla(${hue}, 80%, 65%, 0.16)`,
      border: `hsla(${hue}, 80%, 65%, 0.45)`,
      accent: `hsl(${hue}, 80%, 70%)`
    }
  };
}

/**
 * Creates a ready-to-use color instance with CSS class and inline variable styles.
 */
export function getMemberColorInstance(index: number, isDark = true): MemberColorInstance {
  const def = getMemberColorDef(index);
  const current = isDark ? def.dark : def.light;
  return {
    index: def.index,
    name: def.name,
    className: `member-color-${def.index}`,
    cssVars: `--member-text:${current.text}; --member-bg:${current.bg}; --member-border:${current.border}; --member-accent:${current.accent};`,
    light: def.light,
    dark: def.dark,
    current
  };
}

/**
 * Assigns distinct color indices to members of a household deterministically.
 * - Respects pre-existing colorIndex if already present.
 * - Uses member ID clues (e.g. m1 -> 0, m2 -> 1) when available.
 * - Never collides within the same household.
 * - Adding or deleting members preserves existing members' indices.
 */
export function assignMemberColorIndices<T extends MemberLike>(members: T[]): Map<string, number> {
  const map = new Map<string, number>();
  const usedIndices = new Set<number>();

  if (!Array.isArray(members) || members.length === 0) {
    return map;
  }

  // Pass 1: Keep pre-existing valid colorIndex
  for (const m of members) {
    const idKey = m.id || m.memberId;
    if (idKey && typeof m.colorIndex === 'number' && m.colorIndex >= 0) {
      map.set(idKey, m.colorIndex);
      usedIndices.add(m.colorIndex);
      const nameKey = m.name || m.memberName;
      if (nameKey) map.set(nameKey, m.colorIndex);
    }
  }

  // Pass 2: If member has an ID like "m1", "m2", "m3", prefer (num - 1) if slot is free
  for (const m of members) {
    const idKey = m.id || m.memberId;
    if (idKey && !map.has(idKey)) {
      const match = idKey.match(/^m(\d+)$/i);
      if (match) {
        const preferred = parseInt(match[1], 10) - 1;
        if (preferred >= 0 && !usedIndices.has(preferred)) {
          map.set(idKey, preferred);
          usedIndices.add(preferred);
          const nameKey = m.name || m.memberName;
          if (nameKey) map.set(nameKey, preferred);
        }
      }
    }
  }

  // Pass 3: Fill any remaining members with lowest available unused index
  let candidate = 0;
  for (const m of members) {
    const idKey = m.id || m.memberId;
    const nameKey = m.name || m.memberName;
    const key = idKey || nameKey;
    if (key && !map.has(key)) {
      while (usedIndices.has(candidate)) {
        candidate++;
      }
      map.set(key, candidate);
      if (idKey) map.set(idKey, candidate);
      if (nameKey) map.set(nameKey, candidate);
      usedIndices.add(candidate);
    }
  }

  return map;
}

/**
 * Returns next unused non-negative integer for newly added members in a household.
 */
export function getNextAvailableMemberColorIndex(existingMembers: MemberLike[]): number {
  const used = new Set<number>();
  if (Array.isArray(existingMembers)) {
    for (const m of existingMembers) {
      if (typeof m.colorIndex === 'number' && m.colorIndex >= 0) {
        used.add(m.colorIndex);
      }
    }
  }
  let next = 0;
  while (used.has(next)) {
    next++;
  }
  return next;
}

/**
 * Builds a fast lookup map from memberId/memberName to MemberColorInstance.
 */
export function buildHouseholdColorMap<T extends MemberLike>(
  members: T[],
  isDark = true
): Map<string, MemberColorInstance> {
  const indexMap = assignMemberColorIndices(members);
  const colorMap = new Map<string, MemberColorInstance>();

  for (const [key, idx] of indexMap.entries()) {
    colorMap.set(key, getMemberColorInstance(idx, isDark));
  }

  return colorMap;
}

/**
 * Retrieves color instance for a member, using household registry if provided,
 * with deterministic fallback based on memberId or memberName.
 */
export function getMemberColor(
  memberId?: string | null,
  memberName?: string | null,
  householdMembers?: MemberLike[],
  isDark = true
): MemberColorInstance {
  const cleanId = (memberId || '').trim();
  const cleanName = (memberName || '').trim();

  if (householdMembers && householdMembers.length > 0) {
    const map = buildHouseholdColorMap(householdMembers, isDark);
    if (cleanId && map.has(cleanId)) return map.get(cleanId)!;
    if (cleanName && map.has(cleanName)) return map.get(cleanName)!;
  }

  if (cleanId) {
    const mMatch = cleanId.match(/^m(\d+)$/i);
    if (mMatch) {
      const idx = Math.max(0, parseInt(mMatch[1], 10) - 1);
      return getMemberColorInstance(idx, isDark);
    }
  }

  // Stable string hash fallback
  const str = cleanId || cleanName || 'member';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const stableIndex = Math.abs(hash) % MEMBER_PRIMARY_PALETTE.length;
  return getMemberColorInstance(stableIndex, isDark);
}
