import { type IDisposable } from '@oi/base';
import { describe, expect, it, vi } from 'vitest';
import { createDecorator } from './instantiation';
import {
  IInstantiationService,
  InstantiationService,
  ServiceCollection,
  SyncDescriptor,
} from './instantiationService';

interface IGreeter {
  greet(name: string): string;
}

const IGreeter = createDecorator<IGreeter>('greeter');

class Greeter implements IGreeter {
  greet(name: string): string {
    return `hello ${name}`;
  }
}

class Dependent {
  constructor(
    @IGreeter readonly greeter: IGreeter,
    readonly label: string,
  ) {}
}

describe('createDecorator', () => {
  it('同一服务 id 返回同一标识', () => {
    const first = createDecorator('same');
    const second = createDecorator('same');

    expect(first).toBe(second);
  });

  it('toString 返回服务 id', () => {
    expect(String(IGreeter)).toBe('greeter');
  });
});

describe('InstantiationService', () => {
  it('按装饰器声明的依赖注入并追加静态参数', () => {
    const services = new ServiceCollection();
    services.set(IGreeter, new Greeter());
    const instantiation = new InstantiationService(services);

    const dependent = instantiation.createInstance(Dependent, 'label-1');

    expect(dependent.greeter).toBeInstanceOf(Greeter);
    expect(dependent.label).toBe('label-1');
  });

  it('SyncDescriptor 在首次使用时实例化且只创建一次', () => {
    const createCount = vi.fn();
    class LazyService {
      constructor() {
        createCount();
      }
    }
    const ILazyService = createDecorator<LazyService>('lazyService');
    const services = new ServiceCollection();
    services.set(ILazyService, new SyncDescriptor(LazyService));
    const instantiation = new InstantiationService(services);

    expect(createCount).not.toHaveBeenCalled();
    const first = instantiation.get(ILazyService);
    const second = instantiation.get(ILazyService);

    expect(first).toBe(second);
    expect(createCount).toHaveBeenCalledTimes(1);
  });

  it('缺少服务注册时抛出', () => {
    const IMissingService = createDecorator<{ value: number }>('missingService');
    const instantiation = new InstantiationService(new ServiceCollection());

    expect(() => instantiation.get(IMissingService)).toThrow(/未找到服务/);
  });

  it('循环依赖抛出且可恢复', () => {
    interface IServiceA {
      readonly name: string;
    }
    interface IServiceB {
      readonly name: string;
    }
    const IServiceA = createDecorator<IServiceA>('serviceA');
    const IServiceB = createDecorator<IServiceB>('serviceB');
    class ServiceA implements IServiceA {
      readonly name = 'a';
      constructor(@IServiceB readonly b: IServiceB) {}
    }
    class ServiceB implements IServiceB {
      readonly name = 'b';
      constructor(@IServiceA readonly a: IServiceA) {}
    }

    const services = new ServiceCollection();
    services.set(IServiceA, new SyncDescriptor(ServiceA));
    services.set(IServiceB, new SyncDescriptor(ServiceB));
    const instantiation = new InstantiationService(services);

    expect(() => instantiation.get(IServiceA)).toThrow(/循环依赖/);

    services.set(IServiceA, { name: 'recovered' });
    expect(instantiation.get(IServiceA).name).toBe('recovered');
  });

  it('invokeFunction 通过访问器取服务', () => {
    const services = new ServiceCollection();
    services.set(IGreeter, new Greeter());
    const instantiation = new InstantiationService(services);

    const greeting = instantiation.invokeFunction((accessor) => accessor.get(IGreeter).greet('oi'));

    expect(greeting).toBe('hello oi');
  });

  it('自身注册进容器', () => {
    const instantiation = new InstantiationService(new ServiceCollection());

    expect(instantiation.get(IInstantiationService)).toBe(instantiation);
  });

  it('容器释放时释放其创建的 IDisposable 服务', () => {
    class DisposableService implements IDisposable {
      disposed = false;
      dispose(): void {
        this.disposed = true;
      }
    }
    const IDisposableService = createDecorator<DisposableService>('disposableService');
    const services = new ServiceCollection();
    services.set(IDisposableService, new SyncDescriptor(DisposableService));
    const instantiation = new InstantiationService(services);

    const service = instantiation.get(IDisposableService);
    instantiation.dispose();

    expect(service.disposed).toBe(true);
  });
});
