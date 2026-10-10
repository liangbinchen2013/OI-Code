import {
  faChevronDown,
  faChevronUp,
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
import type { ILanguageService } from '@oi/editor';
import { useCallback, useMemo, useState } from 'react';
import { CodeField } from './codeField';
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

/** 风格开关按"用户看得见的差别"分组，勾选项默认折叠。 */
const TOGGLE_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly items: ReadonlyArray<readonly [BooleanStyleKey, string]>;
}> = [
  {
    items: [
      ['indentWithTabs', WORKBENCH_STRINGS.formatTabIndent],
      ['braceNextLine', WORKBENCH_STRINGS.formatBraceNextLine],
      ['spaceBeforeBrace', WORKBENCH_STRINGS.formatSpaceBeforeBrace],
    ],
    title: '缩进与花括号',
  },
  {
    items: [
      ['singleStatementOnSameLine', WORKBENCH_STRINGS.formatSameLineBody],
      ['elseSameLine', WORKBENCH_STRINGS.formatElseSameLine],
      ['spaceBeforeElse', WORKBENCH_STRINGS.formatSpaceBeforeElse],
      ['indentCaseLabels', WORKBENCH_STRINGS.formatCaseIndent],
      ['allowMultipleStatementsPerLine', WORKBENCH_STRINGS.formatKeepStatements],
      ['allowShortBlocksOnOneLine', WORKBENCH_STRINGS.formatKeepShortBlocks],
    ],
    title: '换行与行结构',
  },
  {
    items: [
      ['spaceAfterControlKeyword', WORKBENCH_STRINGS.formatSpaceAfterKeyword],
      ['spaceInsideParens', WORKBENCH_STRINGS.formatSpaceInsideParens],
      ['spaceAfterComma', WORKBENCH_STRINGS.formatSpaceAfterComma],
      ['spaceAfterSemicolon', WORKBENCH_STRINGS.formatSpaceAfterSemicolon],
      ['attachPointerToType', WORKBENCH_STRINGS.formatPointerToType],
    ],
    title: '括号与分隔符',
  },
  {
    items: [
      ['spaceAroundAssignment', WORKBENCH_STRINGS.formatSpaceAroundAssignment],
      ['spaceAroundComparison', WORKBENCH_STRINGS.formatSpaceAroundComparison],
      ['spaceAroundArithmetic', WORKBENCH_STRINGS.formatSpaceAroundArithmetic],
      ['spaceAroundBitwise', WORKBENCH_STRINGS.formatSpaceAroundBitwise],
      ['spaceAroundLogical', WORKBENCH_STRINGS.formatSpaceAroundLogical],
      ['spaceAroundLeftShift', WORKBENCH_STRINGS.formatSpaceAroundLeftShift],
      ['spaceAroundRightShift', WORKBENCH_STRINGS.formatSpaceAroundRightShift],
      ['spaceAroundConditional', WORKBENCH_STRINGS.formatSpaceAroundConditional],
    ],
    title: '运算符两侧空格',
  },
];

const TOGGLE_LABELS = new Map<BooleanStyleKey, string>(
  TOGGLE_GROUPS.flatMap((group) => [...group.items]),
);

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
  readonly languageService: ILanguageService;
  readonly fontSize?: number;
  readonly tabSize?: number;
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
  languageService,
  fontSize,
  tabSize,
}: IFormatToolProps) {
  const [sample, setSample] = useState('');
  const [analysis, setAnalysis] = useState<IStyleAnalysis | undefined>(undefined);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [togglesOpen, setTogglesOpen] = useState(false);
  const style = useMemo(() => activeStyle(profiles), [profiles]);
  const activeName = profiles.profiles.find((profile) => profile.id === profiles.activeId)?.name;

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
      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatProfile}</h3>
        <div className="oi-format-row">
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
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-btn-secondary"
            title={WORKBENCH_STRINGS.formatAddProfile}
            aria-label={WORKBENCH_STRINGS.formatAddProfile}
            onClick={() =>
              onProfilesChange(
                addProfile(profiles, WORKBENCH_STRINGS.formatNewProfile, { ...style }),
              )
            }
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-btn-secondary"
            title={WORKBENCH_STRINGS.formatRemoveProfile}
            aria-label={WORKBENCH_STRINGS.formatRemoveProfile}
            disabled={profiles.profiles.length <= 1}
            onClick={() => onProfilesChange(removeProfile(profiles, profiles.activeId))}
          >
            <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
          </button>
        </div>
        <input
          className="oi-input oi-format-name"
          value={activeName ?? ''}
          aria-label={WORKBENCH_STRINGS.formatProfileName}
          onChange={(event) =>
            onProfilesChange(
              updateProfile(profiles, profiles.activeId, { name: event.target.value }),
            )
          }
        />
      </section>

      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatSampleTitle}</h3>
        <p className="oi-format-hint">{WORKBENCH_STRINGS.formatSampleHint}</p>
        <CodeField
          languageService={languageService}
          ariaLabel={WORKBENCH_STRINGS.formatSampleTitle}
          heightPx={150}
          testId="sample"
          value={sample}
          fontSize={fontSize}
          tabSize={tabSize}
          onChange={setSample}
        />
        <div className="oi-format-actions">
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-btn-sm"
            data-oi-role="analyze"
            onClick={() => void runAnalysis()}
          >
            <FontAwesomeIcon icon={faWandMagicSparkles} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.formatAnalyze}</span>
          </button>
          <label
            className={analysis === undefined ? 'oi-format-inline' : 'oi-format-inline is-wide'}
          >
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
        </div>
        {analysis !== undefined ? (
          <p className="oi-format-confidence" role="status">
            {WORKBENCH_STRINGS.formatConfidence.replace(
              '{percent}',
              String(Math.round(analysis.confidence * 100)),
            )}
            {' · '}
            {analysis.evidence
              .slice(0, 4)
              .map((entry) => {
                const label = TOGGLE_LABELS.get(entry.key) ?? entry.key;
                return `${label} ${entry.yes}/${entry.yes + entry.no}`;
              })
              .join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatStyleTitle}</h3>
        <button
          type="button"
          className="oi-btn oi-format-disclosure"
          data-oi-role="style-disclosure"
          aria-expanded={togglesOpen}
          onClick={() => setTogglesOpen((open) => !open)}
        >
          <FontAwesomeIcon
            icon={togglesOpen ? faChevronUp : faChevronDown}
            aria-hidden="true"
            className="oi-format-disclosure-icon"
          />
          <span>
            {togglesOpen
              ? WORKBENCH_STRINGS.formatStyleCollapse
              : WORKBENCH_STRINGS.formatStyleExpand.replace('{count}', String(TOGGLE_LABELS.size))}
          </span>
        </button>
        {togglesOpen ? (
          <>
            {TOGGLE_GROUPS.map((group) => (
              <div key={group.title} className="oi-format-group">
                <h4 className="oi-format-group-title">{group.title}</h4>
                <div className="oi-format-toggles">
                  {group.items.map(([key, label]) => (
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
              </div>
            ))}
            <p className="oi-format-hint">{WORKBENCH_STRINGS.formatStyleHint}</p>
          </>
        ) : null}
      </section>

      <section className="oi-format-section">
        <h3 className="oi-format-section-title">{WORKBENCH_STRINGS.formatRunTitle}</h3>
        <CodeField
          languageService={languageService}
          ariaLabel={WORKBENCH_STRINGS.formatInput}
          heightPx={180}
          testId="input"
          value={input}
          fontSize={fontSize}
          tabSize={tabSize}
          onChange={setInput}
        />
        <div className="oi-format-actions">
          <button
            type="button"
            className="oi-btn oi-btn-secondary oi-btn-sm"
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
            className="oi-btn oi-btn-primary"
            data-oi-role="run"
            onClick={() => void runFormat()}
          >
            <FontAwesomeIcon icon={faWandMagicSparkles} aria-hidden="true" />
            <span>{WORKBENCH_STRINGS.formatRun}</span>
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-secondary"
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
        <CodeField
          languageService={languageService}
          ariaLabel={WORKBENCH_STRINGS.formatOutput}
          heightPx={180}
          readOnly
          testId="output"
          value={output}
          fontSize={fontSize}
          tabSize={tabSize}
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
