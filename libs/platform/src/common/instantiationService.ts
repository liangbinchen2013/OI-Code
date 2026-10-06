import { type IDisposable, DisposableStore, isDisposable } from '@oi/base';
import {
  type ServiceIdentifier,
  type ServicesAccessor,
  createDecorator,
  getServiceDependencies,
} from './instantiation';

/**
 * 可被实例化服务使用的构造函数类型。
 */
export type Constructor<T> = new (...args: never[]) => T;

/**
 * 延迟实例化描述符：注册进 {@link ServiceCollection} 后，在首次被依赖时创建。
 */
export class SyncDescriptor<T> {
  readonly ctor: Constructor<T>;
  readonly staticArguments: readonly unknown[];
  readonly supportsDelayedInstantiation: boolean;

  constructor(
    ctor: Constructor<T>,
    staticArguments: readonly unknown[] = [],
    supportsDelayedInstantiation = false,
  ) {
    this.ctor = ctor;
    this.staticArguments = staticArguments;
    this.supportsDelayedInstantiation = supportsDelayedInstantiation;
  }
}

/**
 * 服务注册表：保存实例或延迟描述符。
 */
export class ServiceCollection {
  private readonly _entries = new Map<
    ServiceIdentifier<unknown>,
    unknown | SyncDescriptor<unknown>
  >();

  set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): void {
    this._entries.set(
      id as ServiceIdentifier<unknown>,
      instanceOrDescriptor as unknown | SyncDescriptor<unknown>,
    );
  }

  get<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> | undefined {
    const entry = this._entries.get(id as ServiceIdentifier<unknown>);
    return entry as T | SyncDescriptor<T> | undefined;
  }

  has(id: ServiceIdentifier<unknown>): boolean {
    return this._entries.has(id);
  }

  delete(id: ServiceIdentifier<unknown>): boolean {
    return this._entries.delete(id);
  }
}

/**
 * 依赖注入容器契约。
 */
export interface IInstantiationService {
  createInstance<T>(ctor: Constructor<T>, ...args: unknown[]): T;
  get<T>(id: ServiceIdentifier<T>): T;
  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R;
}

export const IInstantiationService = createDecorator<IInstantiationService>('instantiationService');

/**
 * 依赖注入容器：按参数装饰器声明的依赖解析并构造服务。
 * 延迟描述符实例化后的实例会注册进容器，`IDisposable` 实例在容器释放时一并释放。
 */
export class InstantiationService implements IInstantiationService, IDisposable {
  private readonly _services: ServiceCollection;
  private readonly _disposables = new DisposableStore();
  private readonly _activeInstantiations = new Set<ServiceIdentifier<unknown>>();

  constructor(services: ServiceCollection = new ServiceCollection()) {
    this._services = services;
    this._services.set(IInstantiationService, this);
  }

  createInstance<T>(ctor: Constructor<T>, ...args: unknown[]): T {
    const dependencies = getServiceDependencies(ctor);
    const resolvedArguments: unknown[] = [];
    for (const dependency of dependencies) {
      resolvedArguments[dependency.index] = this._getOrCreateServiceInstance(dependency.id);
    }
    const instance = Reflect.construct(ctor, [...resolvedArguments, ...args]) as T;
    return instance;
  }

  get<T>(id: ServiceIdentifier<T>): T {
    return this._getOrCreateServiceInstance(id) as T;
  }

  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R {
    const accessor: ServicesAccessor = {
      get: <T>(id: ServiceIdentifier<T>): T => this._getOrCreateServiceInstance(id) as T,
    };
    return fn(accessor);
  }

  dispose(): void {
    this._disposables.dispose();
  }

  private _getOrCreateServiceInstance(id: ServiceIdentifier<unknown>): unknown {
    const entry = this._services.get(id);
    if (entry instanceof SyncDescriptor) {
      if (this._activeInstantiations.has(id)) {
        throw new Error(`检测到循环依赖：${String(id)}`);
      }
      this._activeInstantiations.add(id);
      try {
        const instance = this.createInstance(entry.ctor, ...entry.staticArguments);
        if (isDisposable(instance)) {
          this._disposables.add(instance);
        }
        this._services.set(id, instance);
        return instance;
      } finally {
        this._activeInstantiations.delete(id);
      }
    }
    if (entry === undefined) {
      throw new Error(`未找到服务：${String(id)}`);
    }
    return entry;
  }
}
