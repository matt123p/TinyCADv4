import React, { FunctionComponent } from 'react';

export interface BrowserProps {
  url: string;
}

export const Browser: FunctionComponent<BrowserProps> = (props: BrowserProps) => {
  return (
    <iframe style={{ width: '100%', height: '100%' }} src={props.url}>
    </iframe>
  );
};
