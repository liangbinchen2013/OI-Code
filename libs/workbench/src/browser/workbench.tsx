import { type IDisposable, toDisposable } from '@oi/base';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './workbench.css';

export interface IWorkbenchOptions {
  readonly container: HTMLElement;
}

/**
 * 在指定容器挂载工作台外壳，返回用于卸载 React 树的释放句柄。
 */
export function renderWorkbench(options: IWorkbenchOptions): IDisposable {
  const root = createRoot(options.container);
  root.render(<div className="oi-workbench" />);
  return toDisposable(() => root.unmount());
}
