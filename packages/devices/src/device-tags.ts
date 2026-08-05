export interface NormalizedDeviceTag {
  readonly key: string;
  readonly label: string;
}

export interface NormalizedDeviceTags {
  readonly tags: readonly NormalizedDeviceTag[];
  readonly group?: NormalizedDeviceTag;
}

const MAX_LABEL_LENGTH = 40;
const MAX_TAGS = 20;
const PRINTABLE_LABEL = /^[\x20-\x7e]+$/;

function normalizeLabel(value: string, field: string): NormalizedDeviceTag {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH || !PRINTABLE_LABEL.test(label)) {
    throw new TypeError(`${field} must be 1-40 printable characters.`);
  }
  return { key: label.toLocaleLowerCase("en-US"), label };
}

export function normalizeDeviceTags(
  labels: readonly string[] = [],
  group?: string,
): NormalizedDeviceTags {
  if (labels.length > MAX_TAGS) {
    throw new TypeError(`A device may have at most ${MAX_TAGS} tags.`);
  }
  const seen = new Set<string>();
  const tags: NormalizedDeviceTag[] = [];
  for (const label of labels) {
    const tag = normalizeLabel(label, "Tag");
    if (!seen.has(tag.key)) {
      seen.add(tag.key);
      tags.push(tag);
    }
  }
  const normalizedGroup = group === undefined ? undefined : normalizeLabel(group, "Group");
  return normalizedGroup === undefined ? { tags } : { tags, group: normalizedGroup };
}
