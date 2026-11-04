import { createForm } from '../src/index.js';
import type { FieldPath, PathValue } from '../src/index.js';

interface FormData {
  profile: { email: string; active: boolean };
  users: { id: number; tags: string[] }[];
  count: number;
}
const form = createForm({ initialValues: { profile: { email: '', active: false }, users: [{ id: 1, tags: [] }], count: 0 } as FormData });
form.setValue('count', 2);
form.setValue('profile.active', true);
form.setValue('users.0.id', 1);
const count: number = form.getValue('count');
const path: FieldPath<FormData> = 'users.0.tags.0';
const nestedValue: PathValue<FormData, 'users.0.id'> = 12;
const field = form.field('profile.email', { validators: [value => value.includes('@') ? undefined : 'Invalid email'] });
field.value.value = 'a@example.com';
const group = form.group('profile');
group.field('active').value.value = true;
form.array('users').append({ id: 2, tags: [] });
// @ts-expect-error nonexistent field path
form.field('notAField');
// @ts-expect-error string is not assignable to numeric count
form.setValue('count', '12');
// @ts-expect-error boolean is not assignable to email string
field.value.value = true;
// @ts-expect-error invalid nested path
form.setValue('profile.missing', 'nope');
// @ts-expect-error cannot register scalar count as array
form.array('count');
// @ts-expect-error invalid child in group
const invalid = group.field('missing');
void [count, path, nestedValue, invalid];
