// Portable profile fields from AppleSyncedProfile and ProfileNamePolicy.
export const profileSlots = ['1', '2', '3', '4', '5', '6'] as const;
export const isProfileSlot = (id: string) => /^\+?0*[1-6]$/.test(id);
export const profileNameLimit = 80;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Foundation's whitespacesAndNewlines includes NEXT LINE (unlike String.trim()).
const trim = (text: string) => text.replace(/^[\p{White_Space}\u200b]+|[\p{White_Space}\u200b]+$/gu, '');
export const displayProfileName = ({ id, name }: { id: string; name: string }) => trim(name) ? name : `Profile ${Number(id)}`;

export function editedProfileName(value: string, previous?: string) {
  if (value === previous) return value;
  const name = trim(value);
  if (!name) throw new Error('profile_name_empty');
  let count = 0;
  for (const segments = graphemes.segment(name)[Symbol.iterator](); !segments.next().done;) {
    if (++count > profileNameLimit) throw new Error('profile_name_length');
  }
  return name;
}

export const avatarGroups = [
  { label: 'Animals and robots', entries: [['artwork:rex', 'Rex'], ['artwork:miso', 'Miso'], ['artwork:pip', 'Pip'],
    ['artwork:marlow', 'Marlow'], ['artwork:squid', 'DJ Squid'], ['artwork:bloop', 'Bloop'], ['artwork:turbo', 'Turbo'],
    ['artwork:dottie', 'Dottie'], ['artwork:beep', 'Beep']] },
  { label: 'Companions', entries: ['Finn', 'Clover', 'Hoot', 'Pebble', 'Bamboo', 'Fuzz', 'Scout', 'Nori', 'Ember']
    .map(name => [`artwork:${name.toLowerCase()}`, name]) },
  { label: 'People', entries: ['Maya', 'Leo', 'Malik', 'Hana', 'Evelyn', 'Kenji', 'Amira', 'Theo', 'Zuri', 'Robin', 'Idris', 'Sofia',
    'Arthur', 'Camila', 'Eli', 'Freya', 'Andre', 'Nadia', 'Sam', 'Miriam', 'Rory', 'Beatrice', 'Jamie', 'Nia']
    .map(name => [`portrait:${name.toLowerCase()}`, name]) },
  { label: 'Symbols', entries: ['Dog', 'Cat', 'Bird', 'Fish', 'Bunny', 'Turtle', 'Lizard', 'Ladybug', 'Butterfly', 'Ant', 'Teddy']
    .map(name => [`template:${name.toLowerCase()}`, name]) },
];
export const isBuiltInAvatar = (id: string) => avatarGroups.some(group => group.entries.some(([value]) => id === value));

export function editedProfileAvatar(value: string, previous?: string) {
  if (value === previous) return value;
  const avatar = value.trim();
  if (!avatar || isBuiltInAvatar(avatar)) return avatar;
  if (avatar.length <= 2048 && /^https:\/\/[^/?#@\\\s]+(?:[/?#]|$)/i.test(avatar) && !/[\s\\]/u.test(avatar)) {
    try {
      const url = new URL(avatar);
      if (url.hostname && !url.username && !url.password) return avatar;
    } catch { /* Invalid image address. */ }
  }
  throw new Error('profile_avatar_invalid');
}

export function profileFieldError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return;
  switch (error.message) {
    case 'profile_name_empty': return 'Enter a profile name.';
    case 'profile_name_length': return `Use ${profileNameLimit} characters or fewer for the profile name.`;
    case 'profile_avatar_invalid': return 'Enter a valid HTTPS image address without sign-in details.';
    case 'profile_template_unavailable': return 'This profile has no readable public add-ons to copy.';
    case 'profile_no_slot': return 'There is no unused profile slot. Use Luma to manage previously deleted profiles.';
  }
}
