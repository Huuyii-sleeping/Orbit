import { Menu, Plus, Search } from "lucide-react";

/** 工作空间面包屑、当前页面搜索和主操作。 */
export function WorkspaceTopBar({ title, sub, primary, query, searchPlaceholder, mobileNavOpen, onToggleMobileNav, onQueryChange, onPrimary }: {
  title: string;
  sub: string;
  primary: string;
  query: string;
  searchPlaceholder?: string;
  mobileNavOpen: boolean;
  onToggleMobileNav: () => void;
  onQueryChange: (value: string) => void;
  onPrimary: () => void;
}) {
  return (
    <header className="topbar">
      <button type="button" className="tool-btn mobile-nav-toggle" aria-label={mobileNavOpen ? "关闭导航" : "打开导航"} aria-expanded={mobileNavOpen} aria-controls="workspace-sidebar" onClick={onToggleMobileNav}><Menu aria-hidden="true" /></button>
      <div className="workspace-breadcrumb"><span>个人空间</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
      <span className="top-sub">{sub}</span><div className="top-sp" />
      {searchPlaceholder ? <label className="search"><Search aria-hidden="true" /><span className="sr-only">{searchPlaceholder}</span><input value={query} placeholder={searchPlaceholder} onChange={(event) => onQueryChange(event.currentTarget.value)} /></label> : null}
      {primary ? <button type="button" className="btn btn-primary" onClick={onPrimary}><Plus aria-hidden="true" /><span>{primary}</span></button> : null}
    </header>
  );
}
