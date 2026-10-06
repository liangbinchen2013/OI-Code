/**
 * 服务标识：既是服务查找键，也是构造函数参数的装饰器。
 * `type` 为编译期占位，用于携带服务接口类型，运行时不存在。
 */
export interface ServiceIdentifier<T> {
  (...args: unknown[]): void;
  readonly type: T;
  toString(): string;
}

/**
 * 在 `invokeFunction` 中按标识取服务的访问器。
 */
export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T;
}

interface ServiceDependency {
  readonly id: ServiceIdentifier<unknown>;
  readonly index: number;
}

/**
 * 可被实例化的构造函数的最小结构。
 */
export type ConstructorLike = abstract new (...args: never[]) => unknown;

const SERVICE_IDS = new Map<string, ServiceIdentifier<unknown>>();
const SERVICE_DEPENDENCIES = new WeakMap<object, ServiceDependency[]>();

function storeServiceDependency(
  id: ServiceIdentifier<unknown>,
  target: object,
  index: number,
): void {
  const dependencies = SERVICE_DEPENDENCIES.get(target) ?? [];
  dependencies.push({ id, index });
  SERVICE_DEPENDENCIES.set(target, dependencies);
}

/**
 * 读取某个类通过参数装饰器声明的全部服务依赖。
 */
export function getServiceDependencies(ctor: ConstructorLike): readonly ServiceDependency[] {
  return SERVICE_DEPENDENCIES.get(ctor) ?? [];
}

/**
 * 由服务 id 生成服务标识；同一 id 重复调用返回同一标识，保证跨模块可用。
 *
 * ```ts
 * const ILogService = createDecorator<ILogService>('logService');
 * class FileService {
 *   constructor(@ILogService private readonly logService: ILogService) {}
 * }
 * ```
 */
export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
  const existing = SERVICE_IDS.get(serviceId);
  if (existing) {
    return existing as ServiceIdentifier<T>;
  }

  const id = function (...args: [object, string | symbol | undefined, number]): void {
    if (args.length !== 3) {
      throw new Error(`@${serviceId} 装饰器只能用于装饰参数`);
    }
    const [target, , index] = args;
    if (typeof target !== 'function') {
      throw new Error(`@${serviceId} 装饰器目前只支持构造函数参数`);
    }
    storeServiceDependency(id, target, index);
  } as unknown as ServiceIdentifier<T>;

  id.toString = () => serviceId;
  SERVICE_IDS.set(serviceId, id as ServiceIdentifier<unknown>);
  return id;
}
