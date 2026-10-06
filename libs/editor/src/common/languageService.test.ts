import { describe, expect, it } from 'vitest';
import { LanguageService, getFileExtension, normalizeExtension } from './languageService';

describe('LanguageService', () => {
  it('注册后按扩展名查询，忽略大小写与点前缀', () => {
    const service = new LanguageService();
    service.registerLanguage({ id: 'cpp', displayName: 'C++', extensions: ['cpp', '.h'] });

    expect(service.getLanguageByExtension('cpp')).toBe('cpp');
    expect(service.getLanguageByExtension('.CPP')).toBe('cpp');
    expect(service.getLanguageByExtension('h')).toBe('cpp');
    expect(service.getLanguageByExtension('py')).toBeUndefined();
  });

  it('重复的语言 id 或扩展名立即抛错', () => {
    const service = new LanguageService();
    service.registerLanguage({ id: 'cpp', displayName: 'C++', extensions: ['cpp'] });

    expect(() =>
      service.registerLanguage({ id: 'cpp', displayName: 'C++ 副本', extensions: ['cc'] }),
    ).toThrow(/语言已注册：cpp/);
    expect(() =>
      service.registerLanguage({ id: 'c', displayName: 'C', extensions: ['.CPP'] }),
    ).toThrow(/已属于语言：cpp/);
  });

  it('释放注册句柄后映射随之移除', () => {
    const service = new LanguageService();
    const registration = service.registerLanguage({
      id: 'python',
      displayName: 'Python',
      extensions: ['py'],
      filenames: ['SConstruct'],
    });

    registration.dispose();

    expect(service.getLanguageByExtension('py')).toBeUndefined();
    expect(service.getLanguageByFileName('SConstruct')).toBeUndefined();
    expect(() =>
      service.registerLanguage({ id: 'python', displayName: 'Python', extensions: ['py'] }),
    ).not.toThrow();
  });

  it('按文件名注册与查询，忽略大小写', () => {
    const service = new LanguageService();
    service.registerLanguage({
      id: 'makefile',
      displayName: 'Makefile',
      extensions: ['mk'],
      filenames: ['Makefile'],
    });

    expect(service.getLanguageByFileName('Makefile')).toBe('makefile');
    expect(service.getLanguageByFileName('MAKEFILE')).toBe('makefile');
    expect(service.getLanguageByFileName('Makefile.am')).toBeUndefined();
    expect(service.getLanguageByExtension('mk')).toBe('makefile');
  });

  it('重复的文件名立即抛错', () => {
    const service = new LanguageService();
    service.registerLanguage({
      id: 'makefile',
      displayName: 'Makefile',
      extensions: [],
      filenames: ['Makefile'],
    });

    expect(() =>
      service.registerLanguage({
        id: 'other',
        displayName: 'Other',
        extensions: [],
        filenames: ['makefile'],
      }),
    ).toThrow(/文件名 makefile 已属于语言：makefile/);
  });
});

describe('扩展名工具', () => {
  it('normalizeExtension 去掉点并小写', () => {
    expect(normalizeExtension('.Cpp')).toBe('cpp');
    expect(normalizeExtension('MD')).toBe('md');
  });

  it('getFileExtension 处理路径、隐藏文件与无扩展名', () => {
    expect(getFileExtension('C:/problems/hello.cpp')).toBe('cpp');
    expect(getFileExtension('C:\\problems\\solution.PY')).toBe('py');
    expect(getFileExtension('C:/problems/.env')).toBeUndefined();
    expect(getFileExtension('C:/problems/Makefile')).toBeUndefined();
    expect(getFileExtension('C:/problems/trailing.')).toBeUndefined();
  });
});
