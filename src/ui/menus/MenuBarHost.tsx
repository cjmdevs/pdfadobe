// The menu bar with the active tab's tool context, so top bar items the user moved into
// a menu (Customize top bar) work there too.
import { useLoadedDocumentId } from "../../app/Commands";
import type { MenuId } from "../../app/appCommands";
import type { ToolContext } from "../../tools/registry";
import { useDocToolContext, useNoDocToolContext } from "../../tools/useToolContext";
import { Guard } from "../Guard";
import { useTopBarLayout } from "../Toolbar";
import { commandsOf, useBarEntries } from "../topbar/barEntries";
import { appCommand } from "../../app/appCommands";
import { MenuBar } from "./MenuBar";

function WithCtx({ ctx }: { ctx: ToolContext }) {
  const layout = useTopBarLayout();
  const entries = useBarEntries(ctx);
  // A built-in item whose command that menu already lists is not listed twice.
  const extra = (menu: MenuId) =>
    entries(
      Object.keys(layout.menus).filter(
        (id) =>
          layout.menus[id] === menu && !commandsOf(id).some((c) => appCommand(c)?.menu === menu),
      ),
    );
  return <MenuBar extra={extra} />;
}

function Doc({ documentId }: { documentId: string }) {
  return <WithCtx ctx={useDocToolContext(documentId)} />;
}

function NoDoc() {
  return <WithCtx ctx={useNoDocToolContext()} />;
}

export function MenuBarHost() {
  const loadedId = useLoadedDocumentId();
  return loadedId ? (
    <Guard resetKey={loadedId} fallback={<NoDoc />}>
      <Doc key={loadedId} documentId={loadedId} />
    </Guard>
  ) : (
    <NoDoc />
  );
}
