// Fake "server" search shared by the framework fixtures: returns every entry containing the
// first word typed, after a delay, like a Workday prompt backed by a network request.
export const LISTS = {
  school: ['Example State College', 'University of Example', 'Sample University', 'University of Exampleton'],
  study: ['Physics', 'Physical Therapy', 'Physiology', 'Astrophysics'],
  city: ['Springfield', 'Springfield, Ontario', 'Springdale'],
};
export function search(key, query) {
  const word = query.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return new Promise((resolve) => setTimeout(() => resolve(word ? LISTS[key].filter((x) => x.toLowerCase().includes(word)) : []), 350));
}
export const FIELDS = [
  ['school', 'School or University'],
  ['study', 'Field of Study'],
  ['city', 'City'],
];
