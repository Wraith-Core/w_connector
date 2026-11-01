import grain from '../tex/pm-grain.png';

/** Paper texture behind the administration workspace. */
export function Ground() {
  return <div className="wa-ground" aria-hidden="true" style={{ backgroundImage: `url(${grain})` }} />;
}
