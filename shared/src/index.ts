export interface PresentationSummary {
  id: string;
  title: string;
  published: boolean;
  protected: boolean;
  shareToken: string;
  /** Bytes of the stored HTML document; 0 means no content yet. */
  htmlSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface Presentation extends PresentationSummary {
  html: string;
}
