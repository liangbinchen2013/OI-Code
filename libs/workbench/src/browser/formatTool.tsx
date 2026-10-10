import {
  faFileImport,
  faFloppyDisk,
  faPlus,
  faTrashCan,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  analyzeCppStyle,
  formatCpp,
  type BooleanStyleKey,
  type ICppStyle,
  type IStyleAnalysis,
} from '@oi/editor';
import { useCallback, useMemo, useState } from 'react';
import type { IJudgeSource } from './judgeTool';
import { WORKBENCH_STRINGS } from './strings';
import {
  activeStyle,
  addProfile,
  removeProfile,
  setActiveProfile,
  updateProfile,
  type IFormatProfileStore,
} from './formatProfiles';

/** 可勾选的风格开关；缩进宽度与空行上限单独给控件。 */
const STYLE_TOGGLES: ReadonlyArray<readonly [BooleanStyleKey, string]> = [
  ['indentWithTabs', WORKBENCH_STRINGS.formatTabIndent],
  ['braceNextLine', WORKBENCH_STRINGS.formatBraceNextLine],
  ['singleStatementOnSameLine', WORKBENCH_STRINGS.formatSameLineBody],
  ['spaceAfterControlKeyword', WORKBENCH_STRINGS.formatSpaceAfterKeyword],
  ['spaceInsideParens', WORKBENCH_STRINGS.formatSpaceInsideParens],
  ['spaceAroundBinaryOperator', WORKBENCH_STRINGS.formatSpaceAroundOperator],
  ['spaceAfterComma', WORKBENCH_STRINGS.formatSpaceAfterComma],
  ['spaceAfterSemicolon', WORKBENCH_STRINGS.formatSpaceAfterSemicolon],
  ['attachPointerToType', WORKBENCH_STRINGS.formatPointerToType],
  ['elseSameLine', WORKBENCH_STRINGS.formatElseSameLine],
  ['spaceBeforeBrace', WORKBENCH_STRINGS.formatSpaceBeforeBrace],
];

const INDENT_WIDTHS: readonly number[] = [2, 3, 4, 8];

/** 置信度低于该值时提示样本不够，别把结论当成用户的真实风格。 */
const CONFIDENT_ENOUGH = 0.85;

export interface IFormatToolProps {
  readonly profiles: IFormatProfileStore;
  readonly onProfilesChange: (next: IFormatProfileStore) => void;
  /** 当前编辑器里可格式化的源（C++）。 */
  readonly resolveSource: () => IJudgeSource | undefined;
  /** 把结果写回编辑器（保留撤销栈）。 */
  readonly applyToEditor: (text: string) => void;
}

/**
 * 代码格式化工具：先用用户自己的代码样本反推风格，再按该风格重排代码。
 * 引擎在 `@oi/editor`，这里只负责编排与展示。
 */
export function FormatTool({
  profiles,
  onProfilesChange,
  resolveSource,
  applyToEditor,
}: IFormatToolProps) {
  const [sample, setSample] = useState('');
  const [analysis, setAnalysis] = useState<IStyleAnalysis | undefined>(undefined);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const style = useMemo(() => activeStyle(profiles), [profiles]);

  const patchStyle = useCallback(
    (patch: Partial<ICppStyle>): void => {
      onProfilesChange(
        updateProfile(profiles, profiles.activeId, { style: { ...style, ...patch } }),
      );
      setNotice(undefined);
    },
    [onProfilesChange, profiles, style],
  );

  const runAnalysis = useCallback((): void => {
    if (sample.trim().length === 0) {
      setNotice(WORKBENCH_STRINGS.formatNeedSample);
      return;
    }
    const result = analyzeCppStyle(sample);
    setAnalysis(result);
    onProfilesChange(updateProfile(profiles, profiles.activeId, { style: result.style }));
    setNotice(
      result.confidence < CONFIDENT_ENOUGH
        ? WORKBENCH_STRINGS.formatLowConfidence
        : WORKBENCH_STRINGS.formatAnalyzed,
    );
  }, [onProfilesChange, profiles, sample]);

  const runFormat = useCallback((): void => {
    if (input.trim().length === 0) {
      setNotice(WORKBENCH_STRINGS.formatNeedCode);
      return;
    }
    const outcome = formatCpp(input, style);
    setOutput(outcome.formatted);
    setNotice(
      outcome.skipped
        ? (outcome.reason ?? WORKBENCH_STRINGS.formatSkipped)
        : outcome.changed
          ? WORKBENCH_STRINGS.formatChanged
          : WORKBENCH_STRINGS.formatAlreadyClean,
    );
  }, [input, style]);

  return (
    <div className="oi-format">
      <div className="oi-format-row">
        <label className="oi-format-field">
          <span className="oi-settings-label">{WORKBENCH_STRINGS.formatProfile}</span>
          <select
            className="oi-select"
            value={profiles.activeId}
            aria-label={WORKBENCH_STRINGS.formatProfile}
            onChange={(event) => onProfilesChange(setActiveProfile(profiles, event.target.value))}
          >
            {profiles.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <input
          className="oi-input oi-format-name"
          value={profiles.profiles.find((profile) => profile.id === profiles.activeId)?.name ?? ''}
          aria-label={WORKBENCH_STRINGS.formatProfileName}
          onChange={(event) =>
            onProfilesChange(
              updateProfile(profiles, profiles.activeId, { name: event.target.value }),
            )
          }
        />
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-btn-secondary oi-format-add"
          title={WORKBENCH_STRINGS.formatAddProfile}
          aria-label={WORKBENCH_STRINGS.formatAddProfile}
          onClick={() =>
            onProfilesChange(addProfile(profiles, WORKBENCH_STRINGS.formatNewProfile, { ...style }))
          }
        >
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="oi-btn oi-btn-icon oi-btn-secondary oi-format-remove"
          title={WORKBENCH_STRINGS.formatRemoveProfile}
          aria-label={WORKBENCH_STRINGS.formatRemoveProfile}
          disabled={profiles.profiles.length <= 1}
          onClick={() => onProfilesChange(removeProfile(profiles, profiles.activeId))}
        >
          <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
        </button>
      </div>

      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatSampleTitle}</h3>
        <p className="oi-format-hint">{WORKBENCH_STRINGS.formatSampleHint}</p>
        <textarea
          className="oi-input oi-format-textarea oi-format-sample"
          rows={6}
          spellCheck={false}
          value={sample}
          aria-label={WORKBENCH_STRINGS.formatSampleTitle}
          placeholder={'#include <bits/stdc++.h>\nusing namespace std;\nint main(){...}'}
          onChange={(event) => setSample(event.target.value)}
        />
        <button
          type="button"
          className="oi-btn oi-btn-secondary oi-format-analyze"
          onClick={() => void runAnalysis()}
        >
          <FontAwesomeIcon icon={faWandMagicSparkles} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.formatAnalyze}</span>
        </button>
        {analysis !== undefined ? (
          <p className="oi-format-confidence" role="status">
            {WORKBENCH_STRINGS.formatConfidence.replace(
              '{percent}',
              String(Math.round(analysis.confidence * 100)),
            )}
            {' · '}
            {analysis.evidence
              .slice(0, 4)
              .map((entry) => `${entry.key} ${entry.yes}/${entry.yes + entry.no}`)
              .join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatStyleTitle}</h3>
        <div className="oi-format-toggles">
          {STYLE_TOGGLES.map(([key, label]) => (
            <label key={key} className="oi-checkbox-row oi-format-toggle">
              <input
                type="checkbox"
                checked={style[key]}
                onChange={(event) => patchStyle({ [key]: event.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <label className="oi-format-field">
          <span className="oi-settings-label">{WORKBENCH_STRINGS.formatIndentWidth}</span>
          <select
            className="oi-select"
            value={String(style.indentWidth)}
            aria-label={WORKBENCH_STRINGS.formatIndentWidth}
            onChange={(event) => patchStyle({ indentWidth: Number(event.target.value) })}
          >
            {INDENT_WIDTHS.map((width) => (
              <option key={width} value={String(width)}>
                {width}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatRunTitle}</h3>
        <textarea
          className="oi-input oi-format-textarea oi-format-input"
          rows={8}
          spellCheck={false}
          value={input}
          aria-label={WORKBENCH_STRINGS.formatInput}
          onChange={(event) => setInput(event.target.value)}
        />
        <div className="oi-format-actions">
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-btn-sm oi-format-load"
            onClick={() => {
              const source = resolveSource();
              if (source === undefined) {
                setNotice(WORKBENCH_STRINGS.formatNoEditorSource);
                return;
              }
              setInput(source.content);
              setNotice(undefined);
            }}
          >
            <FontAwesomeIcon icon={faFileImport} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.formatLoadFromEditor}</span>
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-primary oi-format-run"
            onClick={() => void runFormat()}
          >
            <FontAwesomeIcon icon={faWandMagicSparkles} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.formatRun}</span>
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-format-apply"
            disabled={output.length === 0}
            onClick={() => {
              applyToEditor(output);
              setNotice(WORKBENCH_STRINGS.formatApplied);
            }}
          >
            <FontAwesomeIcon icon={faFloppyDisk} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.formatApplyToEditor}</span>
          </button>
        </div>
        <textarea
          className="oi-input oi-format-textarea oi-format-output"
          rows={8}
          spellCheck={false}
          readOnly
          value={output}
          aria-label={WORKBENCH_STRINGS.formatOutput}
          placeholder={WORKBENCH_STRINGS.formatOutputEmpty}
        />
        {notice !== undefined ? (
          <p className="oi-format-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </div>
  );
}
