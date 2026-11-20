/**
 * The MathML elements the metric formulas use (ADR-0020). React renders them
 * in the MathML namespace, but its typings do not list them.
 */
import type { HTMLAttributes } from "react";

type MathProps = HTMLAttributes<Element> & {
  display?: "block" | "inline";
  form?: "prefix" | "infix" | "postfix";
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathProps;
      mrow: MathProps;
      mi: MathProps;
      mn: MathProps;
      mo: MathProps;
      mtext: MathProps;
      mfrac: MathProps;
      msqrt: MathProps;
      msup: MathProps;
      msub: MathProps;
    }
  }
}
