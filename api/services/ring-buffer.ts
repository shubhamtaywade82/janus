/**
 * RingBuffer
 * A memory-efficient, O(1) bounded queue implementation using a pre-allocated array.
 * Prevents garbage collection overhead and memory fragmentation at high tick rates.
 */
export class RingBuffer<T> {
  private buffer: T[];
  private pointer = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be greater than 0");
    }
    this.buffer = new Array(capacity);
  }

  /**
   * Pushes a new item into the ring buffer, overwriting the oldest item if at capacity.
   */
  push(item: T): void {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /**
   * Returns all values in chronological order (oldest to newest).
   */
  values(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.pointer - this.count + i + this.capacity) % this.capacity;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  /**
   * Returns the current size of the buffer.
   */
  size(): number {
    return this.count;
  }

  /**
   * Clears the buffer.
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.pointer = 0;
    this.count = 0;
  }
}
