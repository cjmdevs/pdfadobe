// Error boundary for document-bound UI.
//
// EmbedPDF plugins drop their per-document state when a document closes, slightly before
// the core state does; a component rendering in that window throws ("Spread state not
// found"). Without a boundary React would unmount the whole app. The boundary renders
// nothing until `resetKey` (the document id) changes, and never shows document text.
import { Component, type ReactNode } from "react";

interface Props {
  resetKey: string | null;
  children: ReactNode;
  fallback?: ReactNode;
}

export class Guard extends Component<Props, { failedFor: string | null | undefined }> {
  override state = { failedFor: undefined as string | null | undefined };

  static getDerivedStateFromError(): Partial<{ failedFor: string | null | undefined }> {
    return { failedFor: null };
  }

  override componentDidCatch(error: unknown) {
    this.setState({ failedFor: this.props.resetKey });
    // Plugin error messages name document ids and plugin states, never document content.
    console.warn("view error (recovered):", error instanceof Error ? error.message : String(error));
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failedFor !== undefined) {
      this.setState({ failedFor: undefined });
    }
  }

  override render() {
    return this.state.failedFor === undefined ? this.props.children : (this.props.fallback ?? null);
  }
}
