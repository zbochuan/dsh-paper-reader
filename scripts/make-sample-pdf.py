"""Generate a small two-column-free sample paper for local development.

Usage: python3 scripts/make-sample-pdf.py out.pdf   (needs reportlab)
The text is invented for testing; it is not a real paper.
"""
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("Serif", FONT_DIR + "DejaVuSerif.ttf"))
pdfmetrics.registerFont(TTFont("Serif-Bold", FONT_DIR + "DejaVuSerif-Bold.ttf"))

body = ParagraphStyle("body", fontName="Serif", fontSize=10.5, leading=15, spaceAfter=8)
title = ParagraphStyle("title", fontName="Serif-Bold", fontSize=16, leading=20, spaceAfter=6, alignment=1)
authors = ParagraphStyle("authors", fontName="Serif", fontSize=10, leading=14, spaceAfter=14, alignment=1)
h1 = ParagraphStyle("h1", fontName="Serif-Bold", fontSize=12, leading=16, spaceBefore=8, spaceAfter=6)
eq = ParagraphStyle("eq", fontName="Serif", fontSize=11, leading=18, alignment=1, spaceBefore=4, spaceAfter=10)

P = lambda t: Paragraph(t, body)
story = [
    Paragraph("Stable Token Routing for Sparse Mixture-of-Experts", title),
    Paragraph("Sample Author A · Sample Author B", authors),
    Paragraph("Abstract", h1),
    P("Sparse Mixture-of-Experts (MoE) models route each token to a small subset of experts. "
      "Early in training the router often collapses onto a few experts, wasting capacity. We study a "
      "temperature-scaled gate and a load-balance loss, and show that together they remove expert "
      "collapse without slowing convergence."),
    Paragraph("1 Introduction", h1),
    P("Scaling dense Transformers is expensive because every parameter is used for every token. "
      "An MoE layer replaces the feed-forward block with E experts and a router that selects the top-k "
      "experts per token, so compute grows with k rather than E."),
    P("We use the following notation throughout. Let z denote the router logits over the expert pool, "
      "let τ be the gate temperature, and let λ be the weight of the auxiliary balance loss. "
      "The initial temperature τ₀ is a hyperparameter, set to 2.0 unless stated otherwise."),
    P("Our contributions are: (i) an annealed temperature schedule for the gate; (ii) an analysis of "
      "the coefficient of variation (CV) of expert load; and (iii) experiments on language modelling."),
    PageBreak(),
    Paragraph("2 Background", h1),
    P("The router produces logits z = W x for a token representation x. Standard MoE layers apply a "
      "softmax over z and keep the top-k entries. Without constraints, a handful of experts receive "
      "most tokens, a failure mode known as expert collapse."),
    P("Prior work adds noise to the logits or caps the number of tokens per expert (the capacity factor). "
      "Both reduce collapse but introduce extra hyperparameters that interact with the batch size."),
    Paragraph("3 Method", h1),
    Paragraph("3.1 Temperature-scaled gating", h1),
    P("To counter early collapse, we rescale router logits by a temperature τ that is annealed from τ₀ "
      "to 1 over the first 10% of training, which keeps the gate distribution close to uniform while "
      "experts are still undifferentiated."),
    Paragraph("p<sub>i</sub> = exp(z<sub>i</sub> / τ) / Σ<sub>j</sub> exp(z<sub>j</sub> / τ)        (3)", eq),
    P("A larger τ flattens the distribution and spreads tokens across experts; as τ approaches 1 the "
      "router recovers the standard softmax gate. Annealing over 10% of steps is sufficient, and "
      "longer schedules bring no further benefit."),
    PageBreak(),
    Paragraph("3.2 Auxiliary balance loss", h1),
    P("We additionally penalise the squared CV of expert load within each batch, weighted by λ. "
      "We keep λ fixed at 0.01 throughout training; larger values hurt perplexity."),
    Paragraph("4 Experiments", h1),
    P("We train MoE models with E = 64 experts and top-2 routing on a 300B-token corpus. With the "
      "annealed gate, the fraction of dead experts after 5k steps drops from 23% to under 1%, and final "
      "perplexity improves by 0.4 points."),
    Paragraph("5 Conclusion", h1),
    P("A simple temperature schedule on the router, combined with a light balance loss, prevents expert "
      "collapse in sparse MoE training at no extra cost."),
]

out = sys.argv[1] if len(sys.argv) > 1 else "sample.pdf"
SimpleDocTemplate(out, pagesize=letter, leftMargin=72, rightMargin=72, topMargin=72, bottomMargin=72,
                  title="Stable Token Routing (sample)").build(story)
print("wrote", out)
