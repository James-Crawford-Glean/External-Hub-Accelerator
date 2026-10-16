import { split } from './lambda';
import { MIGRATIONS } from './migrations.generated';

describe('split', () => {
  it('strips -- line comments and splits on ;', () => {
    const sql = `
      CREATE TABLE a (id int); -- trailing comment
      -- full line comment
      CREATE TABLE b (id int);
    `;
    expect(split(sql)).toEqual(['CREATE TABLE a (id int)', 'CREATE TABLE b (id int)']);
  });

  it('strips /* */ block comments', () => {
    expect(split('/* header */ CREATE TABLE a (id int);')).toEqual(['CREATE TABLE a (id int)']);
    expect(split('CREATE TABLE a (\n  id int /* inline */\n);')).toEqual(['CREATE TABLE a (\n  id int \n)']);
  });

  it('drops empty statements (trailing ;, blank lines, comment-only files)', () => {
    expect(split('CREATE TABLE a (id int);;\n\n')).toEqual(['CREATE TABLE a (id int)']);
    expect(split('-- only a comment\n')).toEqual([]);
    expect(split('')).toEqual([]);
  });

  it('keeps -- inside the same line only up to the marker', () => {
    expect(split('SELECT 1; -- note\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('MIGRATIONS', () => {
  it('is non-empty', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
  });

  it('is sorted by filename', () => {
    const files = MIGRATIONS.map((m) => m.file);
    expect(files).toEqual([...files].sort());
  });

  it('every entry carries splittable SQL', () => {
    for (const { file, sql } of MIGRATIONS) {
      expect(sql.length).toBeGreaterThan(0);
      expect(split(sql).length).toBeGreaterThan(0);
      expect(file).toMatch(/\.sql$/);
    }
  });
});
