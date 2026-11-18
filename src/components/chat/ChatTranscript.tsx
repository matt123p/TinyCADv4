import React, { useEffect, useState } from 'react';
import { Attachment, ChatMessage, ToolCall } from '../../chat/types';
import { ChatMarkdown } from './ChatMarkdown';

function Disclosure({
  title,
  className,
  children,
}: {
  title: React.ReactNode;
  className: string;
  children: React.ReactNode | (() => React.ReactNode);
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {expanded && (typeof children === 'function' ? children() : children)}
    </details>
  );
}
function ViewedImage({ file }: { file: Attachment }) {
  const src = `data:${file.mime};base64,${file.data}`;
  return (
    <Disclosure className="chat-viewed-image" title="Model viewed an image">
      <img src={src} alt={`Image viewed by the model: ${file.name}`} />
      <a href={src} download={file.name}>
        Save image
      </a>
    </Disclosure>
  );
}
function ToolActivity({
  call,
  result,
  working,
}: {
  call: ToolCall;
  result?: ChatMessage['result'];
  working: boolean;
}) {
  const state = result
    ? result.error
      ? 'Failed'
      : 'Completed'
    : working
    ? 'Running'
    : 'Not completed';
  return (
    <Disclosure
      className="chat-tool"
      title={
        <>
          {state}: {call.name}
        </>
      }
    >
      {() => (
        <>
          <div className="chat-tool-section">
            <strong>Arguments</strong>
            <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
          </div>
          {result && (
            <div className="chat-tool-section">
              <strong>Result</strong>
              <pre>{JSON.stringify(result.data, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </Disclosure>
  );
}
function isImage(file: Attachment) {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
    file.mime,
  );
}

function Turn({
  user,
  messages,
}: {
  user: ChatMessage;
  messages: ChatMessage[];
}) {
  const working = user.status === 'working';
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  const latest = user.lastActivity || user.currentActivity || '';
  const tools = messages.flatMap((message, index) =>
    message.role === 'assistant'
      ? (message.calls || []).map((call) => {
          // Match only this assistant response's result block; Gemini may reuse local IDs.
          const following: ChatMessage[] = [];
          for (
            let i = index + 1;
            i < messages.length && messages[i].role === 'tool';
            i++
          )
            following.push(messages[i]);
          return {
            call,
            result: following.find((item) => item.call.id === call.id)?.result,
            key: `${index}-${call.id}`,
          };
        })
      : [],
  );
  const imageCount = [user, ...messages]
    .filter((message) => message.imagesViewed)
    .reduce(
      (total, message) =>
        total +
        (message.result?.images || message.attachments || []).filter(isImage)
          .length,
      0,
    );
  const hasActivity =
    working ||
    tools.length > 0 ||
    messages.some((message) => !!message.webSearches?.length) ||
    imageCount > 0 ||
    !!user.progress?.length ||
    messages.some((message) => !!message.reasoning || !!message.calls?.length);
  let toolIndex = 0;
  const activity = messages.map((message, index) => (
    <React.Fragment key={index}>
      {message.webSearches?.map((search) => (
        <Disclosure
          key={search.id}
          className="chat-tool"
          title="Searched the web"
        >
          <pre>{JSON.stringify(search.action, null, 2)}</pre>
        </Disclosure>
      ))}
      {message.reasoning && (
        <Disclosure className="chat-reasoning" title="Thinking">
          <ChatMarkdown text={message.reasoning} />
        </Disclosure>
      )}
      {!!message.calls?.length && (
        <>
          {message.text && (
            <Disclosure className="chat-progress" title="Progress update">
              <ChatMarkdown text={message.text} />
            </Disclosure>
          )}
          {message.calls.map(() => {
            const tool = tools[toolIndex++];
            return (
              <ToolActivity
                key={tool.key}
                call={tool.call}
                result={tool.result}
                working={working}
              />
            );
          })}
        </>
      )}
      {message.imagesViewed &&
        (message.result?.images || [])
          .filter(isImage)
          .map((file, i) => <ViewedImage key={`image-${i}`} file={file} />)}
    </React.Fragment>
  ));
  const state = working
    ? 'Working…'
    : user.status === 'error'
    ? 'Stopped with an issue'
    : user.status === 'stopped'
    ? 'Stopped'
    : 'Worked';
  return (
    <>
      <article className="chat-message chat-user" aria-label="Your message">
        <div className="chat-text">{user.text}</div>
        {user.attachments?.map((file, i) => (
          <small key={i}>Attached: {file.name}</small>
        ))}
      </article>
      {hasActivity && (
        <Disclosure
          className="chat-activity"
          title={
            <>
              <span
                className={
                  working
                    ? 'chat-activity-state chat-activity-working'
                    : 'chat-activity-state'
                }
              >
                {state}
              </span>
              {latest && (
                <span title={latest}>
                  {' '}
                  · {latest.replace(/\s+/g, ' ').slice(0, 140)}
                </span>
              )}
              {tools.length > 0 && (
                <span>
                  {' '}
                  · {tools.length} tool {tools.length === 1 ? 'call' : 'calls'}
                </span>
              )}
              {imageCount > 0 && (
                <span>
                  {' '}
                  ·{' '}
                  {imageCount === 1
                    ? 'Model viewed an image'
                    : `Model viewed ${imageCount} images`}
                </span>
              )}
            </>
          }
        >
          {!!user.progress?.length && (
            <ol className="chat-activity-log">
              {user.progress
                .filter((event) => event.kind !== 'retry')
                .map((event, i) => (
                  <li key={i}>
                    {event.at && (
                      <small>
                        {new Date(event.at).toLocaleTimeString()} ·{' '}
                      </small>
                    )}
                    {event.text}
                  </li>
                ))}
            </ol>
          )}
          {user.progress
            ?.filter((event) => event.kind === 'retry')
            .map((event, i) => (
              <Disclosure
                className="chat-progress"
                key={i}
                title="Retrying reply"
              >
                <p>{event.text}</p>
              </Disclosure>
            ))}
          {user.imagesViewed &&
            user.attachments
              ?.filter(isImage)
              .map((file, i) => (
                <ViewedImage key={`upload-${i}`} file={file} />
              ))}
          {activity}
          {working && (
            <p className="chat-activity-pending">
              {user.currentActivity || 'Preparing the request'} ·{' '}
              {Math.max(
                0,
                Math.floor((now - (user.activityStarted || now)) / 1000),
              )}
              s elapsed
              {user.liveReasoning && (
                <span className="chat-live-progress">
                  {user.liveReasoning.slice(-6000)}
                </span>
              )}
              {user.liveText && (
                <span className="chat-live-progress">
                  {user.liveText.slice(-6000)}
                </span>
              )}
            </p>
          )}
        </Disclosure>
      )}
      {messages
        .filter(
          (message) =>
            message.role === 'assistant' &&
            !message.calls?.length &&
            !!message.text,
        )
        .map((message, i) => (
          <article key={i} className="chat-message chat-assistant">
            <strong>TinyCAD</strong>
            <ChatMarkdown text={message.text} />
          </article>
        ))}
    </>
  );
}
export const ChatTranscript: React.FC<{ messages: ChatMessage[] }> = ({
  messages,
}) => {
  const turns: { key: number; user: ChatMessage; messages: ChatMessage[] }[] =
    [];
  messages.forEach((message, index) => {
    if (message.role === 'user')
      turns.push({ key: index, user: message, messages: [] });
    else turns[turns.length - 1]?.messages.push(message);
  });
  return (
    <>
      {turns.map((turn) => (
        <Turn key={turn.key} user={turn.user} messages={turn.messages} />
      ))}
    </>
  );
};
