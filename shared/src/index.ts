export type ThemeName = 'boardroom' | 'midnight';

export interface Slide {
  id: string;
  position: number;
  html: string;
  notes: string | null;
}

export interface DeckSummary {
  id: string;
  title: string;
  theme: ThemeName;
  published: boolean;
  protected: boolean;
  shareToken: string;
  slideCount: number;
  firstSlideHtml: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deck extends DeckSummary {
  slides: Slide[];
}

/** Fixed slide canvas. Slides are authored against this and scaled to fit. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
