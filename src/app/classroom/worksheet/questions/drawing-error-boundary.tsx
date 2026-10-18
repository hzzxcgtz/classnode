'use client';

import styles from '../worksheet.module.css';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Keep a failed lazy-loaded drawing tool from taking down the whole worksheet. */
export class DrawingErrorBoundary extends Component<{
  toolLabel: string;
  children: ReactNode;
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[学习单绘图：${this.props.toolLabel}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 16 }}>
        <p>{this.props.toolLabel}暂时无法加载，其他任务可以继续作答。</p>
        <p>请将下面的错误信息告知老师：</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {this.state.error.name}: {this.state.error.message}
        </pre>
        <button type="button" className={styles.submitButton} onClick={() => this.setState({ error: null })}>重新加载画板</button>
      </div>
    );
  }
}
