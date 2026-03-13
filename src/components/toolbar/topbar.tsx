import { PersonProhibitedRegular, PersonRegular } from '@fluentui/react-icons';
import React, { ChangeEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dispatch } from 'redux';
import { renameFile } from '../../io/files';
import { CurrentFile, CurrentUser } from '../../state/stores/altStoreReducer';
import { openExternalUrl } from '../../util/navigation';

interface TopbarProps {
  user: CurrentUser;
  file: CurrentFile;
  saveNeeded: boolean;
  dispatch: Dispatch;
}

export const Topbar: React.FC<TopbarProps> = ({
  user,
  file,
  saveNeeded,
  dispatch,
}) => {
  const { t } = useTranslation();
  const [edit, setEdit] = useState(false);
  const [filename, setFilename] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFilename(file.name);
  }, [file.name]);

  useEffect(() => {
    if (edit && inputRef.current) {
      inputRef.current.focus();
    }
  }, [edit]);

  const beforeUnloadListener = useCallback(
    (event: BeforeUnloadEvent) => {
      if (saveNeeded) {
        event.preventDefault();
        const msg = t('topbar.unsavedWarning');
        event.returnValue = msg;
        return msg;
      }
    },
    [saveNeeded, t]
  );

  useEffect(() => {
    addEventListener('beforeunload', beforeUnloadListener);
    return () => {
      removeEventListener('beforeunload', beforeUnloadListener);
    };
  }, [beforeUnloadListener]);

  const changeFilename = (e: ChangeEvent<HTMLInputElement>) => {
    setFilename(e.target.value);
  };

  const commitFilename = () => {
    if (!filename || filename.length === 0) {
      setFilename(file.name);
      setEdit(false);
    } else {
      renameFile(filename, file.id, dispatch);
      setEdit(false);
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitFilename();
    }
  };

  let login;
  if (user?.name) {
    login = (
      <ul className="menu">
        <li>
          <a>
            <span className="topbar-user-icon">
              <PersonRegular />
            </span>
            {user.name}
          </a>
        </li>
      </ul>
    );
  } else if (user !== null) {
    login = null;
  } else {
    login = (
      <a>
        <span className="topbar-user-icon">
          <PersonProhibitedRegular />
        </span>
      </a>
    );
  }

  let displayName = '';
  if (user && file) {
    displayName = file.name;
  }
  if (displayName && displayName.length > 0 && saveNeeded) {
    displayName = displayName + '*';
  }

  return (
    <div>
      <div className="top-bar">
        <div className="top-bar-left ">
          <ul className="menu">
            <li>
              <a
                href="https://www.tinycad.net"
                className="top-bar-title"
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  openExternalUrl('https://www.tinycad.net');
                }}
              >
                TinyCAD.net
              </a>
              {edit ? (
                <input
                  value={filename}
                  onChange={changeFilename}
                  onBlur={commitFilename}
                  ref={inputRef}
                  onKeyPress={handleKeyPress}
                />
              ) : (
                <span
                  onClick={() => {
                    if (process.env.TARGET_SYSTEM === 'google') {
                      setEdit(true);
                    }
                  }}
                >
                  {displayName}
                </span>
              )}
            </li>
          </ul>
        </div>
        <div className="top-bar-right">{login}</div>
      </div>
    </div>
  );
};

