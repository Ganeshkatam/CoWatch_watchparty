import React, { RefObject, useContext } from "react";
import {
  ActionIcon,
  Avatar,
  Button,
  HoverCard,
  TextInput,
  Tooltip,
} from "@mantine/core";
// import data from '@emoji-mart/data';
import Picker from "@emoji-mart/react";
import { init } from "emoji-mart";
// import onClickOutside from 'react-onclickoutside';
//@ts-expect-error
import Linkify from "react-linkify";
import { SecureLink } from "react-secure-link";
import { IconTrash } from "@tabler/icons-react";
import styles from "./Chat.module.css";
import { useEffect, useState, useCallback } from 'react';
import { createUuid } from "../../utils/utils";

export interface RoomMessage {
  id: string; // author clientId
  msg: string;
  cmd?: string;
  timestamp: string;
  videoTS?: number;
  dbId?: string;
  name?: string;
}

export function useRoomMessages(socket: Socket | undefined) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!socket) return;

    const handleRoomMessages = (data: RoomMessage[]) => {
      setMessages((prev) => {
        const merged = [...prev, ...data];
        const unique = Array.from(new Map(merged.map(item => [item.dbId || item.timestamp, item])).values());
        unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return unique;
      });
      setIsLoading(false);
      setIsLoadingMore(false);
      if (data.length < 50) {
        setHasMore(false);
      }
    };

    const handleRoomMessage = (data: RoomMessage) => {
      setMessages((prev) => {
        if (prev.some(m => m.dbId === data.dbId || (m.timestamp === data.timestamp && m.id === data.id))) {
          return prev;
        }
        return [...prev, data];
      });
    };

    const handleChatInit = (data: RoomMessage[]) => {
      setMessages(data);
      setIsLoading(false);
    };

    socket.on("ROOM_MESSAGES", handleRoomMessages);
    socket.on("ROOM_MESSAGE", handleRoomMessage);
    socket.on("chatinit", handleChatInit);
    socket.on("REC:chat", handleRoomMessage);

    return () => {
      socket.off("ROOM_MESSAGES", handleRoomMessages);
      socket.off("ROOM_MESSAGE", handleRoomMessage);
      socket.off("chatinit", handleChatInit);
      socket.off("REC:chat", handleRoomMessage);
    };
  }, [socket]);

  const loadMore = useCallback(() => {
    if (!socket || isLoadingMore || !hasMore || messages.length === 0) return;
    setIsLoadingMore(true);
    const oldestMessage = messages[0];
    if (oldestMessage && oldestMessage.dbId) {
      socket.emit("CMD:loadMessages", { 
        beforeCursor: { createdAt: oldestMessage.timestamp, id: oldestMessage.dbId } 
      });
    } else if (oldestMessage && oldestMessage.timestamp) {
      socket.emit("CMD:loadMessages", { beforeCursor: oldestMessage.timestamp });
    }
  }, [socket, messages, isLoadingMore, hasMore]);

  const sendMessage = useCallback((msg: string, replyTo?: any) => {
    if (!socket) return;
    const chatPayload: any = {
      msg,
      replyToId: replyTo?.id,
      replyToTimestamp: replyTo?.timestamp,
      clientMessageId: createUuid(),
    };
    socket.emit("CMD:chatV2", chatPayload);
  }, [socket]);

  return {
    messages,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    sendMessage,
  };
}

import {
  formatTimestamp,
  getColorForStringHex,
  getDefaultPicture,
  getOrCreateClientId,
  isEmojiString,
} from "../../utils/utils";
import { UserMenu } from "../UserMenu/UserMenu";
import { Socket } from "socket.io-client";
import {
  CSSTransition,
  SwitchTransition,
  TransitionGroup,
} from "react-transition-group";
import { MetadataContext } from "../../MetadataContext";

const clientId = getOrCreateClientId();
const truncateReply = (input?: string, max = 30) =>
  input && input.length > max ? `${input.slice(0, max)}...` : input || "";

interface ChatProps {
  chat: ChatMessage[];
  nameMap: StringDict;
  pictureMap: StringDict;
  socket: Socket;
  scrollTimestamp: number;
  className?: string;
  getMediaDisplayName: (input?: string) => string;
  hide?: boolean;
  isChatDisabled?: boolean;
  owner: string | undefined;
  onEdit?: (messageId: string, newMessage: string) => void;
  clearChat?: () => void;
}

export class ChatComponent extends React.Component<ChatProps & { onLoadMore?: () => void, hasMore?: boolean, isLoading?: boolean }> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = {
    chatMsg: "",
    replyTo: undefined as
      | { id: string; timestamp: string; msg?: string }
      | undefined,
    isNearBottom: true,
    isPickerOpen: false,
    confirmClear: false,
    reactionMenu: {
      isOpen: false,
      selectedMsgId: "",
      selectedMsgTimestamp: "",
      yPosition: 0,
      xPosition: 0,
    },
  };
  messagesRef = React.createRef<HTMLDivElement>();
  chatInputRef = React.createRef<HTMLInputElement>();

  async componentDidMount() {
    this.scrollToBottom();
    this.messagesRef.current?.addEventListener("scroll", this.onScroll);
    init({});
  }

  componentDidUpdate(prevProps: ChatProps) {
    if (this.props.scrollTimestamp !== prevProps.scrollTimestamp) {
      if (prevProps.scrollTimestamp === 0 || this.state.isNearBottom) {
        this.scrollToBottom();
      }
    }
    if (this.props.hide !== prevProps.hide) {
      this.scrollToBottom();
    }
  }

  setReactionMenu = (
    isOpen: boolean,
    selectedMsgId?: string,
    selectedMsgTimestamp?: string,
    yPosition?: number,
    xPosition?: number,
  ) => {
    this.setState({
      reactionMenu: {
        isOpen,
        selectedMsgId,
        selectedMsgTimestamp,
        yPosition,
        xPosition,
      },
    });
  };

  handleReactionClick = (value: string, id?: string, timestamp?: string) => {
    const msg = this.props.chat.find(
      (m) => m.id === id && m.timestamp === timestamp,
    );
    const data = {
      value,
      msgId: id || this.state.reactionMenu.selectedMsgId,
      msgTimestamp: timestamp || this.state.reactionMenu.selectedMsgTimestamp,
    };
    if (msg?.reactions?.[value].includes(clientId)) {
      this.props.socket.emit("CMD:removeReaction", data);
    } else {
      this.props.socket.emit("CMD:addReaction", data);
    }
  };

  updateChatMsg = (e: any) => {
    // console.log(e.target.selectionStart);
    this.setState({ chatMsg: e.target.value });
  };

  sendChatMsg = () => {
    if (!this.state.chatMsg) {
      return;
    }
    if (this.chatTooLong()) {
      return;
    }
    const clientMessageId = createUuid();
    if (this.state.replyTo?.id && this.state.replyTo.timestamp) {
      const chatPayload: ChatPayload = {
        msg: this.state.chatMsg,
        replyToId: this.state.replyTo.id,
        replyToTimestamp: this.state.replyTo.timestamp,
        clientMessageId,
      };
      this.props.socket.emit("CMD:chatV2", chatPayload);
      this.setState({ chatMsg: "", replyTo: undefined });
      return;
    }
    this.setState({ chatMsg: "", replyTo: undefined });
    this.props.socket.emit("CMD:chatV2", { msg: this.state.chatMsg, clientMessageId });
  };

  setReplyTo = (id: string, timestamp: string, msg?: string) => {
    this.setState({ replyTo: { id, timestamp, msg } });
    this.chatInputRef.current?.focus();
  };

  clearReplyTo = () => {
    this.setState({ replyTo: undefined });
  };

  chatTooLong = () => {
    return Boolean(this.state.chatMsg?.length > 10000);
  };

  onScroll = () => {
    this.setState({ isNearBottom: this.isChatNearBottom() });
    if (this.messagesRef.current && this.messagesRef.current.scrollTop === 0) {
      if (this.props.onLoadMore) {
        this.props.onLoadMore();
      }
    }
  };

  isChatNearBottom = () => {
    return (
      this.messagesRef.current &&
      this.messagesRef.current.scrollHeight -
      this.messagesRef.current.scrollTop -
      this.messagesRef.current.offsetHeight <
      50
    );
  };

  scrollToBottom = () => {
    if (this.messagesRef.current) {
      this.messagesRef.current.scrollTop =
        this.messagesRef.current.scrollHeight;
    }
  };

  formatMessage = (cmd: string, msg?: string): React.ReactNode | string => {
    if (cmd === "host") {
      return (
        <React.Fragment>
          {`changed the video to `}
          <span style={{ textTransform: "initial" }}>
            {this.props.getMediaDisplayName(msg)}
          </span>
        </React.Fragment>
      );
    } else if (cmd === "playlistAdd") {
      return (
        <React.Fragment>
          {`added to the playlist: `}
          <span style={{ textTransform: "initial" }}>
            {this.props.getMediaDisplayName(msg)}
          </span>
        </React.Fragment>
      );
    } else if (cmd === "seek") {
      return `jumped to ${formatTimestamp(msg)}`;
    } else if (cmd === "play") {
      return `started the video at ${formatTimestamp(msg)}`;
    } else if (cmd === "pause") {
      return `paused the video at ${formatTimestamp(msg)}`;
    } else if (cmd === "playbackRate") {
      return `set the playback rate to ${msg === "0" ? "auto" : `${msg}x`}`;
    } else if (cmd === "lock") {
      return `locked the room`;
    } else if (cmd === "unlock") {
      return "unlocked the room";
    } else if (cmd === "vBrowserTimeout") {
      return (
        <React.Fragment>
          The VBrowser shut down automatically.
          <br />
          Subscribe for longer sessions.
        </React.Fragment>
      );
    } else if (cmd === "vBrowserAlmostTimeout") {
      return (
        <React.Fragment>
          The VBrowser will shut down soon.
          <br />
          Subscribe for longer sessions.
        </React.Fragment>
      );
    }
    return cmd;
  };

  addEmoji = (emoji: any) => {
    this.setState({ chatMsg: this.state.chatMsg + emoji.native });
  };

  render() {
    const isOwner = Boolean(this.context?.user && this.props.owner && this.props.owner === this.context.user.id);
    return (
      <div
        className={this.props.className}
        style={{
          display: this.props.hide ? "none" : "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          marginTop: 0,
          marginBottom: 0,
          padding: "8px",
          backgroundColor: "var(--bg-elevated)",
        }}
      >
        {isOwner && this.props.clearChat && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              padding: "4px 0",
              marginBottom: "4px",
              borderBottom: "1px solid var(--border-subtle)",
              minHeight: "32px",
            }}
          >
            {this.state.confirmClear ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  Clear all messages?
                </span>
                <Button
                  size="compact-xs"
                  color="red"
                  variant="filled"
                  onClick={() => {
                    this.props.clearChat?.();
                    this.setState({ confirmClear: false });
                  }}
                >
                  Confirm
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => this.setState({ confirmClear: false })}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Tooltip label="Clear all chat messages" position="left">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => this.setState({ confirmClear: true })}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </div>
        )}
        <div
          className={styles.chatContainer}
          ref={this.messagesRef}
          style={{ position: "relative" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {this.props.isLoading && <div style={{textAlign: 'center', padding: '10px', color: 'var(--text)'}}>Loading...</div>}
            {!this.props.isLoading && this.props.hasMore && (
              <div style={{textAlign: 'center', padding: '10px'}}>
                <Button size="xs" variant="subtle" onClick={this.props.onLoadMore}>Load Older Messages</Button>
              </div>
            )}
            {this.props.chat.filter((msg) => !msg.cmd).map((msg) => (
              <ChatMessage
                key={msg.timestamp + msg.id}
                className={
                  msg.id === this.state.reactionMenu.selectedMsgId &&
                    msg.timestamp === this.state.reactionMenu.selectedMsgTimestamp
                    ? styles.selected
                    : ""
                }
                message={msg}
                pictureMap={this.props.pictureMap}
                nameMap={this.props.nameMap}
                formatMessage={this.formatMessage}
                owner={this.props.owner}
                socket={this.props.socket}
                isChatDisabled={this.props.isChatDisabled}
                setReactionMenu={this.setReactionMenu}
                handleReactionClick={this.handleReactionClick}
                onReply={this.setReplyTo}
                onEdit={this.props.onEdit}
              />
            ))}
            {/* <div ref={this.messagesEndRef} /> */}
          </div>
          {!this.state.isNearBottom && (
            <Button
              size="xs"
              onClick={this.scrollToBottom}
              style={{
                position: "sticky",
                bottom: 0,
                display: "block",
                margin: "0 auto",
              }}
            >
              Jump to bottom
            </Button>
          )}
        </div>
        {this.state.isPickerOpen && (
          <div style={{ position: "absolute", bottom: "60px" }}>
            <Picker
              theme="dark"
              previewPosition="none"
              maxFrequentRows={1}
              onEmojiSelect={this.addEmoji}
              onClickOutside={() => this.setState({ isPickerOpen: false })}
            />
          </div>
        )}
        <CSSTransition
          in={this.state.reactionMenu.isOpen}
          timeout={300}
          classNames={{
            enter: styles["reactionMenu-enter"],
            enterActive: styles["reactionMenu-enter-active"],
            exit: styles["reactionMenu-exit"],
            exitActive: styles["reactionMenu-exit-active"],
          }}
          unmountOnExit
        >
          <div
            style={{
              position: "fixed",
              top: Math.min(
                this.state.reactionMenu.yPosition - 150,
                window.innerHeight - 450,
              ),
              left: this.state.reactionMenu.xPosition - 240,
            }}
          >
            <Picker
              theme="dark"
              previewPosition="none"
              maxFrequentRows={1}
              perLine={6}
              onClickOutside={() => this.setReactionMenu(false)}
              onEmojiSelect={(emoji: any) => {
                this.handleReactionClick(emoji.native);
                this.setReactionMenu(false);
              }}
            />
          </div>
        </CSSTransition>
        {this.state.replyTo && (
          <div
            className={styles.replyComposer}
            style={{
              marginTop: 10,
              padding: "6px 8px",
              borderLeft: "2px solid var(--color-blue)",
              borderRadius: "4px",
              background: "var(--surface-active)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div className={styles.small + " " + styles.light}>
              Replying to {this.props.nameMap[this.state.replyTo.id] || "Unknown"}
              {this.state.replyTo.msg ? (
                <div
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 260,
                  }}
                >
                  {this.state.replyTo.msg}
                </div>
              ) : null}
            </div>
            <Button size="xs" variant="subtle" onClick={this.clearReplyTo}>
              Cancel
            </Button>
          </div>
        )}
        <TextInput
          ref={this.chatInputRef}
          style={{ marginTop: "10px" }}
          onKeyDown={(e: any) => e.key === "Enter" && this.sendChatMsg()}
          onChange={this.updateChatMsg}
          value={this.state.chatMsg}
          error={this.chatTooLong()}
          disabled={this.props.isChatDisabled}
          placeholder={
            this.props.isChatDisabled
              ? "The chat was disabled by the room owner."
              : "Enter a message..."
          }
          rightSection={
            <ActionIcon
              onClick={() => {
                // Add a delay to prevent the click from triggering onClickOutside
                const curr = this.state.isPickerOpen;
                setTimeout(() => this.setState({ isPickerOpen: !curr }), 100);
              }}
              disabled={this.props.isChatDisabled}
            >
              <span role="img" aria-label="Emoji">
                😀
              </span>
            </ActionIcon>
          }
        >
          {/* <Icon onClick={this.sendChatMsg} name="send" inverted circular link /> */}
        </TextInput>
      </div>
    );
  }
}

const ChatMessage = ({
  message,
  nameMap,
  pictureMap,
  formatMessage,
  socket,
  owner,
  isChatDisabled,
  setReactionMenu,
  handleReactionClick,
  onReply,
  onEdit,
  className,
}: {
  message: ChatMessage;
  nameMap: StringDict;
  pictureMap: StringDict;
  formatMessage: (cmd: string, msg?: string) => React.ReactNode;
  socket: Socket;
  owner: string | undefined;
  isChatDisabled: boolean | undefined;
  setReactionMenu: (
    isOpen: boolean,
    selectedMsgId?: string,
    selectedMsgTimestamp?: string,
    yPosition?: number,
    xPosition?: number,
  ) => void;
  handleReactionClick: (value: string, id?: string, timestamp?: string) => void;
  onReply: (id: string, timestamp: string, msg?: string) => void;
  onEdit?: (messageId: string, newMessage: string) => void;
  className: string;
}) => {
  const { user, avatarUrl } = useContext(MetadataContext);
  const { id, timestamp, cmd, msg, system, isSub, reactions, videoTS, name, picture, userId, updatedAt } =
    message;
  const [isEditing, setIsEditing] = useState(false);
  const [editMsg, setEditMsg] = useState(msg || "");
  const spellFull = 5; // the number of people whose names should be written out in full in the reaction popup
  const imageMsg = renderImageString(msg);
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        position: "relative",
        overflowWrap: "anywhere",
      }}
      className={`${styles.comment} ${className} ${message.replyToUserId === clientId ? styles.replyMessage : ""
        }`}
    >
      {id ? (
        <Avatar
          src={
            (id === clientId ? (pictureMap[id] || avatarUrl) : pictureMap[id]) ||
            picture ||
            getDefaultPicture(nameMap[id] || name || 'Unknown', getColorForStringHex(id))
          }
        />
      ) : null}
      <div>
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "flex-end",
            fontSize: 14,
          }}
        >
          <UserMenu
            displayName={nameMap[id] || name || 'Unknown'}
            timestamp={timestamp}
            socket={socket}
            userToManage={id}
            isChatMessage
            disabled={!Boolean(owner && owner === user?.id)}
            trigger={
              <div
                style={{ cursor: "pointer", fontWeight: 700 }}
                title={""}
                className={`${styles.light} ${styles.hoverEffect}`}
              >
                {Boolean(system) && "System"}
                {nameMap[id] || name || 'Unknown'}
              </div>
            }
          />
          <div className={styles.small + " " + styles.dark}>
            <div title={new Date(timestamp).toLocaleDateString()}>
              {new Date(timestamp).toLocaleTimeString()} {updatedAt ? "· edited" : ""}
            </div>
          </div>
        </div>
        <div className={styles.light + " " + styles.system}>
          {cmd && formatMessage(cmd, msg)}
        </div>
        {message.replyToUserId && (
          <HoverCard withinPortal={false} openDelay={120}>
            <HoverCard.Target>
              <div className={styles.replyInfo}>
                {`Replying to @${nameMap[message.replyToUserId] || "user"}: `}
                {truncateReply(message.replyToMsg, 30)}
              </div>
            </HoverCard.Target>
            <HoverCard.Dropdown className={styles.replyTooltip}>
              {message.replyToMsg || ""}
            </HoverCard.Dropdown>
          </HoverCard>
        )}
        {isEditing ? (
          <div style={{ flexGrow: 1 }}>
            <TextInput
              value={editMsg}
              onChange={(e) => setEditMsg(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (editMsg.trim().length > 0 && editMsg.trim() !== msg) {
                    onEdit && message.dbId && onEdit(message.dbId, editMsg.trim());
                  }
                  setIsEditing(false);
                } else if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditMsg(msg || '');
                }
              }}
              autoFocus
              rightSectionWidth={60}
              rightSection={
                <div style={{ display: 'flex', gap: '4px', marginRight: '4px' }}>
                  <ActionIcon onClick={() => { setIsEditing(false); setEditMsg(msg || ''); }} size="sm">
                    <span role="img" aria-label="Cancel">❌</span>
                  </ActionIcon>
                  <ActionIcon onClick={() => {
                    if (editMsg.trim().length > 0 && editMsg.trim() !== msg) {
                      onEdit && message.dbId && onEdit(message.dbId, editMsg.trim());
                    }
                    setIsEditing(false);
                  }} size="sm">
                    <span role="img" aria-label="Save">✅</span>
                  </ActionIcon>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <Linkify
              componentDecorator={(
                decoratedHref: string,
                decoratedText: string,
                key: string,
              ) => (
                <SecureLink href={decoratedHref} key={key}>
                  {decoratedText}
                </SecureLink>
              )}
            >
              <div
                className={`${styles.light} ${isEmojiString(msg) ? styles.emoji : ""
                  }`}
              >
                {!cmd && msg}
              </div>
            </Linkify>
            {imageMsg}
          </>
        )}
        <div className={styles.commentMenu}>
          {userId === user?.id && !isEditing && (
            <ActionIcon
              onClick={() => { setIsEditing(true); setEditMsg(msg || ""); }}
              disabled={isChatDisabled}
              style={{
                opacity: 1,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: 0,
                margin: 0,
                marginRight: 4,
              }}
            >
              <span role="img" aria-label="Edit" style={{ margin: 0, fontSize: 16 }}>
                ✎
              </span>
            </ActionIcon>
          )}
          {id && id !== clientId && (
            <ActionIcon
              onClick={() => onReply(id, timestamp, msg)}
              disabled={isChatDisabled}
              style={{
                opacity: 1,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: 0,
                margin: 0,
                marginRight: 4,
              }}
            >
              <span role="img" aria-label="Reply" style={{ margin: 0, fontSize: 16 }}>
                ↩
              </span>
            </ActionIcon>
          )}
          <ActionIcon
            onClick={(e) => {
              //@ts-expect-error
              const viewportOffset = e.target.getBoundingClientRect();
              setTimeout(() => {
                setReactionMenu(
                  true,
                  id,
                  timestamp,
                  viewportOffset.top,
                  viewportOffset.right,
                );
              }, 100);
            }}
            disabled={isChatDisabled}
            style={{
              opacity: 1,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 0,
              margin: 0,
            }}
          >
            <span
              role="img"
              aria-label="React"
              style={{ margin: 0, fontSize: 18 }}
            >
              😀
            </span>
          </ActionIcon>
        </div>
        <TransitionGroup>
          {Object.keys(reactions ?? []).map((key) =>
            reactions?.[key].length ? (
              <CSSTransition
                key={key}
                timeout={200}
                classNames={{
                  enter: styles["reaction-enter"],
                  enterActive: styles["reaction-enter-active"],
                  exit: styles["reaction-exit"],
                  exitActive: styles["reaction-exit-active"],
                }}
                unmountOnExit
              >
                <HoverCard>
                  <HoverCard.Target>
                    <div
                      className={`${styles.reactionContainer} ${reactions[key].includes(clientId)
                        ? styles.highlighted
                        : ""
                        }`}
                      onClick={() =>
                        handleReactionClick(key, message.id, message.timestamp)
                      }
                    >
                      <span
                        style={{
                          fontSize: 17,
                          position: "relative",
                          bottom: 1,
                        }}
                      >
                        {key}
                      </span>
                      <SwitchTransition>
                        <CSSTransition
                          key={key + "-" + reactions[key].length}
                          classNames={{
                            enter: styles["reactionCounter-enter"],
                            enterActive: styles["reactionCounter-enter-active"],
                            exit: styles["reactionCounter-exit"],
                            exitActive: styles["reactionCounter-exit-active"],
                          }}
                          addEndListener={(node, done) =>
                            node.addEventListener("transitionend", done, false)
                          }
                          unmountOnExit
                        >
                          <span
                            className={styles.reactionCounter}
                            style={{
                              color: "var(--text-secondary)",
                              textDecoration: "none",
                              marginLeft: 3,
                            }}
                          >
                            {reactions[key].length}
                          </span>
                        </CSSTransition>
                      </SwitchTransition>
                    </div>
                  </HoverCard.Target>
                  <HoverCard.Dropdown>
                    {`${reactions[key]
                      .slice(0, spellFull)
                      .map((id) => nameMap[id] || "Unknown")
                      .concat(
                        reactions[key].length > spellFull
                          ? [`${reactions[key].length - spellFull} more`]
                          : [],
                      )
                      .reduce(
                        (text, value, i, array) =>
                          text +
                          (i < array.length - 1 ? ", " : " and ") +
                          value,
                      )} reacted.`}
                  </HoverCard.Dropdown>
                </HoverCard>
              </CSSTransition>
            ) : null,
          )}
        </TransitionGroup>
      </div>
    </div>
  );
};

export const renderImageString = (
  input: string | undefined,
): React.ReactNode | null => {
  // If a valid image string, return an image
  let regex =
    /^https?:\/\/.*\/.*\.(png|gif|webp|jpeg|jpg|heic|heif|jfif)\??.*$/gim;
  if (String(input)?.match(regex)) {
    return <img style={{ maxWidth: "100%" }} src={input} />;
  }
  return null;
};

// class ReactionMenuInner extends React.Component<{
//   handleReactionClick: (value: string, id?: string, timestamp?: string) => void;
//   closeMenu: () => void;
//   yPosition: number;
//   xPosition: number;
// }> {
//   state = {
//     containerWidth: 0,
//   };
//   handleClickOutside = () => {
//     this.props.closeMenu();
//   };
//   containerRef = React.createRef<HTMLDivElement>();
//   componentDidMount() {
//     this.setState({ containerWidth: this.containerRef.current?.offsetWidth });
//   }
//   render() {
//     return (
//       <div
//         ref={this.containerRef}
//         className={styles.reactionMenuContainer}
//         style={{
//           top: this.props.yPosition - 9,
//           left: this.props.xPosition - this.state.containerWidth - 35,
//         }}
//       >
//         {reactionEmojis.map((reaction) => (
//           <div
//             onClick={() => {
//               this.props.handleReactionClick(reaction);
//               this.props.closeMenu();
//             }}
//             style={{ cursor: 'pointer' }}
//           >
//             {reaction}
//           </div>
//         ))}
//       </div>
//     );
//   }
// }
// const ReactionMenu = onClickOutside(ReactionMenuInner);

export const Chat = React.forwardRef<ChatComponent, ChatProps>((props, ref) => {
  const { messages, isLoading, hasMore, loadMore } = useRoomMessages(props.socket);
  return <ChatComponent {...props} chat={messages} onLoadMore={loadMore} hasMore={hasMore} isLoading={isLoading} ref={ref} />;
});

