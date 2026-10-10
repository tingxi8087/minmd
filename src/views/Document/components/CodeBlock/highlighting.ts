import { common, createLowlight } from "lowlight";
import dockerfile from "highlight.js/lib/languages/dockerfile";
const languages = createLowlight(common);
languages.register("dockerfile", dockerfile);
languages.registerAlias("typescript", "tsx");
languages.registerAlias("cpp", "c++");
languages.registerAlias("csharp", "c#");
const normalize = (language: string) => language.trim().toLowerCase();
// Unknown custom types stay plain instead of silently guessing another language.
export const codeHighlighter = {
  listLanguages: () => languages.listLanguages(),
  registered: (language: string) => languages.registered(normalize(language)),
  highlight: (language: string, code: string) =>
    languages.highlight(
      languages.registered(normalize(language))
        ? normalize(language)
        : "plaintext",
      code,
    ),
  highlightAuto: (code: string) => languages.highlight("plaintext", code),
};
