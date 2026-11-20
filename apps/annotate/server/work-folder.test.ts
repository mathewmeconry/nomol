import { canWrite, workPath } from './work-folder';

describe('workPath', () => {
  it('resolves files inside the work folder', () => {
    expect(workPath('/w', 'frames/a.jpg')).toBe('/w/frames/a.jpg');
  });

  it('refuses paths leaving it', () => {
    expect(workPath('/w', '../etc/passwd')).toBeNull();
    expect(workPath('/w', '%2e%2e/x')).toBeNull();
    expect(workPath('/w', '')).toBeNull();
  });
});

describe('canWrite', () => {
  it('allows labels and COCO exports only', () => {
    expect(canWrite('labels/test_a_0001000.json')).toBe(true);
    expect(canWrite('coco_train.json')).toBe(true);
    expect(canWrite('tasks.json')).toBe(false);
    expect(canWrite('frames/a.jpg')).toBe(false);
    expect(canWrite('labels/../tasks.json')).toBe(false);
  });
});
