import type { JSX } from 'react';

export interface IconProps {
  name: string;
  spin?: boolean;
  className?: string;
  title?: string;
  style?: import('react').CSSProperties;
}

/** Thin wrapper over Codicons so icon usage stays consistent and accessible. */
export function Icon({ name, spin, className, title, style }: IconProps): JSX.Element {
  const classes = ['codicon', `codicon-${name}`];
  if (spin) {
    classes.push('codicon-modifier-spin');
  }
  if (className) {
    classes.push(className);
  }
  return <span className={classes.join(' ')} aria-hidden={title ? undefined : true} title={title} style={style} />;
}
