import { Pipe, PipeTransform } from '@angular/core';

/**
 * Proper brand casing for platform keys shown in the UI.
 *
 * The backend uses lowercase platform keys ('facebook', 'linkedin', 'x', ...).
 * Angular's built-in `titlecase` would render "Linkedin", "Tiktok", "Youtube"
 * and just "X" — this pipe maps the known keys to their official casing and
 * falls back to a capitalised form for anything not in the map (so a newly
 * added platform still displays sensibly before it's added here).
 *
 * Usage:  {{ platform | platformName }}
 */
const DISPLAY_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
};

@Pipe({ name: 'platformName', standalone: true })
export class PlatformNamePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const key = String(value).trim().toLowerCase();
    if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];
    // Fallback: capitalise the first letter (keeps unknown keys readable).
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
}
