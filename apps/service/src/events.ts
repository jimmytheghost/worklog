export type ServiceEvent = {
  event: "github-sync";
  data: Record<string, unknown>;
};

type Subscriber = (event: ServiceEvent) => void;

export class ServiceEventHub {
  readonly #subscribers = new Set<Subscriber>();

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => this.#subscribers.delete(subscriber);
  }

  publish(event: ServiceEvent): void {
    for (const subscriber of this.#subscribers) subscriber(event);
  }
}
