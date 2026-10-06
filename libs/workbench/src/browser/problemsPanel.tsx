import type { URI } from '@oi/base';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleInfo,
  faCircleXmark,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { DiagnosticSeverity } from '@oi/platform';
import type { ReactElement } from 'react';
import { WORKBENCH_STRINGS } from './strings';

/**
 * 问题面板条目：line/column 为 0 表示无位置信息（如链接错误）。
 */
export interface IProblemItem {
  readonly uri?: URI;
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

export interface IProblemsPanelProps {
  readonly problems: readonly IProblemItem[];
  readonly onSelect: (problem: IProblemItem) => void;
  readonly onClose: () => void;
}

function severityIcon(severity: DiagnosticSeverity): ReactElement {
  if (severity === 'error') {
    return <FontAwesomeIcon icon={faCircleXmark} aria-hidden="true" />;
  }
  if (severity === 'warning') {
    return <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />;
  }
  return <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />;
}

/**
 * 问题面板：控制台风格底部面板，按 `行 | 列 | 原因` 展示编译/检查诊断。
 */
export function ProblemsPanel({ problems, onSelect, onClose }: IProblemsPanelProps) {
  return (
    <section className="oi-problems" aria-label={WORKBENCH_STRINGS.problems}>
      <header className="oi-problems-header">
        <span className="oi-problems-title">
          {WORKBENCH_STRINGS.problems}
          <span className="oi-problems-count">{problems.length}</span>
        </span>
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-btn-secondary oi-problems-close"
          onClick={onClose}
          title={WORKBENCH_STRINGS.problemsClose}
          aria-label={WORKBENCH_STRINGS.problemsClose}
        >
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
        </button>
      </header>
      <div className="oi-problems-list">
        {problems.length === 0 ? (
          <p className="oi-problems-empty">{WORKBENCH_STRINGS.problemsEmpty}</p>
        ) : (
          problems.map((problem, index) => (
            <button
              key={`${problem.fileName}:${problem.line}:${problem.column}:${index}`}
              type="button"
              className={`oi-problem-row oi-problem-${problem.severity}`}
              onClick={() => onSelect(problem)}
              title={problem.uri?.toString()}
            >
              <span className="oi-problem-icon" aria-hidden="true">
                {severityIcon(problem.severity)}
              </span>
              <span className="oi-problem-location">
                {problem.line > 0 ? `${problem.line} | ${problem.column}` : '- | -'}
              </span>
              <span className="oi-problem-message">{problem.message}</span>
              {problem.line > 0 ? (
                <span className="oi-problem-file">{problem.fileName}</span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
