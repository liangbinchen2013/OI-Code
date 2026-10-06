/**
 * URI 组成部分。
 */
export interface UriComponents {
  readonly scheme: string;
  readonly authority?: string;
  readonly path?: string;
  readonly query?: string;
  readonly fragment?: string;
}

const URI_REGEX = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

/**
 * 不可变 URI：IDE 内一切资源定位（文件、文档、设置）的统一标识。
 */
export class URI {
  private constructor(
    private readonly _scheme: string,
    private readonly _authority: string,
    private readonly _path: string,
    private readonly _query: string | undefined,
    private readonly _fragment: string | undefined,
  ) {}

  static isUri(thing: unknown): thing is URI {
    return thing instanceof URI;
  }

  static from(components: UriComponents): URI {
    return new URI(
      components.scheme,
      components.authority ?? '',
      components.path ?? '',
      components.query,
      components.fragment,
    );
  }

  static parse(value: string): URI {
    const match = URI_REGEX.exec(value);
    if (!match || !match[2]) {
      throw new Error(`无法解析的 URI：${value}`);
    }
    return new URI(match[2], match[4] ?? '', match[5] ?? '', match[7], match[9]);
  }

  /**
   * 由本地文件系统路径构造 file URI。
   * Windows 盘符统一规范为 `/c:/...` 存储形式，对外由 {@link fsPath} 还原。
   */
  static file(path: string): URI {
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    return URI.from({ scheme: 'file', path: normalized });
  }

  get scheme(): string {
    return this._scheme;
  }

  get authority(): string {
    return this._authority;
  }

  get path(): string {
    return this._path;
  }

  get query(): string | undefined {
    return this._query;
  }

  get fragment(): string | undefined {
    return this._fragment;
  }

  /**
   * file URI 对应的本地路径；Windows 盘符还原为 `C:/...` 形式。
   */
  get fsPath(): string {
    if (this._scheme !== 'file') {
      return this._path;
    }
    return this._path.replace(/^\/([a-zA-Z]:\/)/, '$1');
  }

  with(change: Partial<UriComponents>): URI {
    return URI.from({
      scheme: change.scheme ?? this._scheme,
      authority: change.authority ?? this._authority,
      path: change.path ?? this._path,
      query: change.query ?? this._query,
      fragment: change.fragment ?? this._fragment,
    });
  }

  toString(): string {
    let result = `${this._scheme}:`;
    if (this._authority.length > 0 || this._scheme === 'file') {
      result += '//';
    }
    result += this._authority;
    result += this._path;
    if (this._query !== undefined) {
      result += `?${this._query}`;
    }
    if (this._fragment !== undefined) {
      result += `#${this._fragment}`;
    }
    return result;
  }

  toJSON(): string {
    return this.toString();
  }
}
