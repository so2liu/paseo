import {
  classifyAssistantFileLink,
  isFileLookingAssistantToken,
  type AssistantFileLinkClassification,
  type InlinePathTarget,
} from "./parse";
import { i18n } from "@/i18n/i18next";

export interface AssistantFileLinkSource {
  href: string;
  text?: string;
  title?: string;
  markup?: string;
  sourceInfo?: string;
  sourceType?: "inline-code";
}

export interface AssistantFileLinkContext {
  workspaceRoot?: string;
}

export interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

export interface DirectorySuggestionResult {
  entries: DirectorySuggestionEntry[];
  error: string | null;
}

export type GetDirectorySuggestions = (input: {
  query: string;
  cwd: string;
  includeFiles: true;
  includeDirectories: false;
  matchMode: "suffix";
  limit: number;
}) => Promise<DirectorySuggestionResult>;

export type ResolvedAssistantFileLink =
  | { kind: "external"; url: string }
  | { kind: "file"; target: InlinePathTarget }
  | { kind: "ignored" };

export type AssistantFileLinkResolution =
  | { kind: "resolved"; value: ResolvedAssistantFileLink }
  | {
      kind: "needsLookup";
      ambiguousQuery: string;
      token: string;
      target: InlinePathTarget;
    };

export interface FetchDaemonResolutionInput {
  ambiguousQuery: string;
  token: string;
  target: InlinePathTarget;
  workspaceRoot?: string;
  getDirectorySuggestions: GetDirectorySuggestions;
}

export class UnresolvedFileLinkError extends Error {
  constructor(readonly token: string) {
    super(i18n.t("common.errors.noFileFound", { token }));
    this.name = "UnresolvedFileLinkError";
  }
}

export class AmbiguousFileLinkError extends Error {
  constructor(readonly token: string) {
    super(i18n.t("common.errors.ambiguousFile", { token }));
    this.name = "AmbiguousFileLinkError";
  }
}

/**
 * How many candidates to ask for before deciding a bare name is ambiguous.
 *
 * One is not enough: with `limit: 1` the daemon's ranking silently decides which
 * `design.md` in the repo the agent meant, and its tie-breakers (match offset, then
 * path order) have nothing to do with intent — a directory whose name starts with a
 * digit wins over the one the user is working in. Asking for a page of candidates is
 * what makes "more than one match" observable at all.
 */
const AMBIGUITY_LOOKUP_LIMIT = 25;

/**
 * Pick the file an agent meant by a path suffix, or nothing.
 *
 * Depth is the only signal that carries intent here. A name written without any
 * directory means the file the workspace is organized around, so the shallowest match
 * wins; `design.md` at the root beats `260402-sandbox/design.md`. When the shallowest
 * depth is shared, nothing in the message distinguishes the candidates, and opening an
 * arbitrary one is worse than saying so — the user follows a link and silently lands in
 * an unrelated file.
 */
function selectUnambiguousMatch(entries: DirectorySuggestionEntry[]): {
  match: DirectorySuggestionEntry | null;
  ambiguous: boolean;
} {
  const files = entries.filter((entry) => entry.kind === "file");
  if (files.length === 0) return { match: null, ambiguous: false };

  const depthOf = (entry: DirectorySuggestionEntry) =>
    entry.path.replace(/\\/g, "/").split("/").filter(Boolean).length;
  const shallowest = Math.min(...files.map(depthOf));
  const contenders = files.filter((entry) => depthOf(entry) === shallowest);
  const [match] = contenders;
  if (!match || contenders.length > 1) {
    return { match: null, ambiguous: true };
  }
  return { match, ambiguous: false };
}

export async function fetchDaemonResolution({
  ambiguousQuery,
  token,
  target,
  workspaceRoot,
  getDirectorySuggestions,
}: FetchDaemonResolutionInput): Promise<InlinePathTarget> {
  const trimmedRoot = workspaceRoot?.trim();
  if (!trimmedRoot) {
    throw new UnresolvedFileLinkError(token);
  }

  let suggestions: DirectorySuggestionResult;
  try {
    suggestions = await getDirectorySuggestions({
      query: ambiguousQuery,
      cwd: trimmedRoot,
      includeFiles: true,
      includeDirectories: false,
      matchMode: "suffix",
      limit: AMBIGUITY_LOOKUP_LIMIT,
    });
  } catch {
    throw new UnresolvedFileLinkError(token);
  }

  if (suggestions.error) {
    throw new UnresolvedFileLinkError(token);
  }

  const { match, ambiguous } = selectUnambiguousMatch(suggestions.entries);
  if (!match) {
    throw ambiguous ? new AmbiguousFileLinkError(token) : new UnresolvedFileLinkError(token);
  }

  return {
    ...target,
    path: joinWorkspacePath(trimmedRoot, match.path),
  };
}

export function classifyForResolution(
  source: AssistantFileLinkSource,
  context: AssistantFileLinkContext,
): AssistantFileLinkResolution {
  const token = getAssistantFileLinkToken(source).trim();
  if (!token) {
    return { kind: "resolved", value: { kind: "ignored" } };
  }

  const classification = classifyAssistantFileLink(token, {
    workspaceRoot: context.workspaceRoot,
  });
  if (!classification) {
    return { kind: "resolved", value: { kind: "ignored" } };
  }
  if (classification.kind === "external") {
    return { kind: "resolved", value: { kind: "external", url: classification.raw } };
  }
  if (
    classification.kind === "directFile" &&
    !shouldResolveDirectFileThroughSuggestions({
      context,
      source,
      token,
      target: classification.target,
    })
  ) {
    return { kind: "resolved", value: { kind: "file", target: classification.target } };
  }

  const workspaceRoot = context.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return { kind: "resolved", value: { kind: "ignored" } };
  }

  return {
    kind: "needsLookup",
    ambiguousQuery: getAmbiguousSuggestionQuery(classification.target, workspaceRoot),
    token,
    target: classification.target,
  };
}

export function getAssistantFileLinkToken(source: AssistantFileLinkSource): string {
  if (isLinkifiedSource(source) || source.sourceType === "inline-code") {
    const text = source.text?.trim();
    if (text && isFileLookingAssistantToken(text)) {
      return text;
    }
  }

  return source.href;
}

export function getAmbiguousSuggestionQuery(
  target: InlinePathTarget,
  workspaceRoot: string,
): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = target.path.replace(/\\/g, "/");
  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  const lastSlash = normalizedPath.lastIndexOf("/");
  return lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
}

export function shouldResolveDirectFileThroughSuggestions(input: {
  context: AssistantFileLinkContext;
  source: AssistantFileLinkSource;
  token: string;
  target: InlinePathTarget;
}): boolean {
  if (input.source.sourceType !== "inline-code") {
    return false;
  }

  if (isAbsoluteInlineCodeToken(input.token)) {
    return false;
  }

  const workspaceRoot = input.context.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return false;
  }

  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = input.target.path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

function isAbsoluteInlineCodeToken(token: string): boolean {
  return (
    token.startsWith("/") ||
    token.toLowerCase().startsWith("file://") ||
    /^[A-Za-z]:[\\/]/.test(token)
  );
}

function isLinkifiedSource(source: AssistantFileLinkSource): boolean {
  return source.markup === "linkify" || source.sourceInfo === "auto";
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const child = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return root ? `${root}/${child}` : child;
}

export type { AssistantFileLinkClassification };
