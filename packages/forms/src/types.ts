import type { ReadonlySignal, WritableSignal } from '@zaakiyjs/signals';
import type { OwnerScope } from '@zaakiyjs/core';

type Prev = [never, 0, 1, 2, 3, 4];
type Primitive = string | number | boolean | bigint | symbol | null | undefined | Date | File | Blob | RegExp;
/** Dotted paths are limited to four segments to keep TS instantiation bounded. */
export type FieldPath<T, D extends 0 | 1 | 2 | 3 | 4 = 4> =
  [D] extends [0] ? never : T extends Primitive ? never :
  T extends readonly (infer Item)[] ? `${number}` | `${number}.${FieldPath<NonNullable<Item>, Prev[D]>}` :
  T extends object ? {
    [K in Extract<keyof T, string>]: NonNullable<T[K]> extends Primitive
      ? K
      : K | `${K}.${FieldPath<NonNullable<T[K]>, Prev[D]>}`
  }[Extract<keyof T, string>] : never;

export type PathValue<T, P extends string> =
  P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T ? PathValue<NonNullable<T[Key]>, Rest>
      : T extends readonly (infer Item)[] ? Key extends `${number}` ? PathValue<NonNullable<Item>, Rest> : never : never
    : P extends keyof T ? T[P]
      : T extends readonly (infer Item)[] ? P extends `${number}` ? Item : never : never;
export type ArrayElement<T> = T extends readonly (infer Item)[] ? Item : never;

export type ValidationTrigger = 'change' | 'blur' | 'submit';
export type ValidationStatus = 'idle' | 'valid' | 'invalid' | 'error' | 'cancelled';
export type IssueSource = 'field' | 'form' | 'server' | 'system';
export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly source: IssueSource;
}
export type ValidationOutput = void | null | string | ValidationIssue | readonly (string | ValidationIssue)[];
export interface FieldValidationContext<T> {
  readonly path: string;
  readonly values: Readonly<T>;
  readonly signal: AbortSignal;
}
export type FieldValidator<T, V> = (value: V, context: FieldValidationContext<T>) => ValidationOutput | Promise<ValidationOutput>;
export type FormValidator<T> = (values: Readonly<T>, context: { readonly signal: AbortSignal }) => ValidationOutput | Promise<ValidationOutput>;
export interface FieldOptions<T, V> {
  readonly validators?: readonly FieldValidator<T, V>[];
  readonly required?: boolean | string;
  readonly disabled?: boolean;
  readonly validateOn?: readonly ValidationTrigger[];
  /** Paths this field's validators read; changing one revalidates this field. */
  readonly dependencies?: readonly FieldPath<T>[];
}
export type ErrorVisibility = 'always' | 'touched' | 'submitted';
export interface FormOptions<T extends object, TResult> {
  readonly initialValues: T;
  readonly owner?: OwnerScope | null;
  readonly onSubmit?: (values: Readonly<T>, context: { readonly signal: AbortSignal }) => TResult | Promise<TResult>;
  readonly validators?: readonly FormValidator<T>[];
  readonly validateOn?: readonly ValidationTrigger[];
  readonly formValidateOn?: readonly ValidationTrigger[];
  readonly errorVisibility?: ErrorVisibility;
  /** Validation timeout in milliseconds; omitted means no timeout. */
  readonly validationTimeoutMs?: number;
  /** Submission timeout in milliseconds; omitted means no timeout. */
  readonly submitTimeoutMs?: number;
}
export interface ValidationResult {
  readonly status: Exclude<ValidationStatus, 'idle'>;
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}
export interface FieldHandle<T extends object, P extends FieldPath<T>> {
  readonly id: string;
  /** A stable handle whose path can change when an array entry moves. */
  readonly path: ReadonlySignal<string>;
  readonly value: WritableSignal<PathValue<T, P>>;
  readonly initialValue: ReadonlySignal<PathValue<T, P>>;
  readonly dirty: ReadonlySignal<boolean>;
  readonly pristine: ReadonlySignal<boolean>;
  readonly touched: ReadonlySignal<boolean>;
  readonly untouched: ReadonlySignal<boolean>;
  readonly errors: ReadonlySignal<readonly ValidationIssue[]>;
  readonly visibleErrors: ReadonlySignal<readonly ValidationIssue[]>;
  readonly pending: ReadonlySignal<boolean>;
  readonly disabled: ReadonlySignal<boolean>;
  readonly status: ReadonlySignal<ValidationStatus>;
  readonly ariaInvalid: ReadonlySignal<boolean>;
  readonly ariaRequired: ReadonlySignal<boolean>;
  blur(): void;
  setDisabled(disabled: boolean): void;
  validate(options?: { readonly signal?: AbortSignal }): Promise<ValidationResult>;
  dispose(): void;
}
export interface ArrayHandle<T extends object, P extends FieldPath<T>> {
  readonly path: ReadonlySignal<string>;
  /** Keys belong to items, never indices; use them for keyed TSX loops. */
  readonly keys: ReadonlySignal<readonly string[]>;
  insert(index: number, value: ArrayElement<PathValue<T, P>>): string;
  append(value: ArrayElement<PathValue<T, P>>): string;
  remove(index: number): void;
  move(from: number, to: number): void;
}
export interface FieldGroup<T extends object, P extends FieldPath<T>> {
  readonly path: P;
  readonly value: ReadonlySignal<PathValue<T, P>>;
  field<C extends FieldPath<PathValue<T, P>>>(child: C, options?: FieldOptions<T, PathValue<PathValue<T, P>, C>>): FieldHandle<T, Extract<`${P}.${C}`, FieldPath<T>>>;
}
export interface SubmissionFailure { readonly kind: 'domain' | 'transport'; readonly message: string }
export type SubmitResult<TResult> =
  | { readonly status: 'success'; readonly value: TResult }
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly status: 'duplicate' | 'aborted' }
  | { readonly status: 'failed'; readonly failure: SubmissionFailure };
export interface FormController<T extends object, TResult> {
  readonly values: ReadonlySignal<Readonly<T>>;
  readonly dirty: ReadonlySignal<boolean>;
  readonly valid: ReadonlySignal<boolean>;
  readonly pendingValidation: ReadonlySignal<boolean>;
  readonly submitting: ReadonlySignal<boolean>;
  readonly submitted: ReadonlySignal<boolean>;
  readonly submitSucceeded: ReadonlySignal<boolean>;
  readonly submitFailure: ReadonlySignal<SubmissionFailure | null>;
  readonly submitCount: ReadonlySignal<number>;
  readonly errors: ReadonlySignal<readonly ValidationIssue[]>;
  field<P extends FieldPath<T>>(path: P, options?: FieldOptions<T, PathValue<T, P>>): FieldHandle<T, P>;
  group<P extends FieldPath<T>>(path: P): FieldGroup<T, P>;
  array<P extends FieldPath<T>>(path: P & (PathValue<T, P> extends readonly unknown[] ? unknown : never)): ArrayHandle<T, P>;
  getValue<P extends FieldPath<T>>(path: P): PathValue<T, P>;
  setValue<P extends FieldPath<T>>(path: P, value: PathValue<T, P>): void;
  setValues(values: T): void;
  validate(options?: { readonly signal?: AbortSignal }): Promise<ValidationResult>;
  validateField<P extends FieldPath<T>>(path: P, options?: { readonly signal?: AbortSignal }): Promise<ValidationResult>;
  reset(values?: T): void;
  submit(options?: { readonly signal?: AbortSignal }): Promise<SubmitResult<TResult>>;
  abortSubmit(): void;
  dispose(): void;
}
