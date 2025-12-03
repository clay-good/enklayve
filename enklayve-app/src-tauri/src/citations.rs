use serde::{Deserialize, Serialize};
use regex::Regex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub document_name: String,
    pub chunk_index: Option<i64>,
    pub page_number: Option<i64>,
    pub quote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageWithCitations {
    pub message: String,
    pub citations: Vec<Citation>,
}

pub fn parse_citations(text: &str) -> MessageWithCitations {
    let mut citations = Vec::new();

    let citation_pattern = Regex::new(
        r"(?i)according to \[([^\]]+)\](?: \((?:chunk|page) (\d+)\))?"
    ).unwrap();

    for cap in citation_pattern.captures_iter(text) {
        let document_name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        let number = cap.get(2).and_then(|m| m.as_str().parse::<i64>().ok());

        let citation = Citation {
            document_name,
            chunk_index: number,
            page_number: number,
            quote: None,
        };

        citations.push(citation);
    }

    let bracket_pattern = Regex::new(r"\[([^\]]+\.(?:pdf|docx|txt|md))\]").unwrap();
    for cap in bracket_pattern.captures_iter(text) {
        let document_name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();

        if !citations.iter().any(|c| c.document_name == document_name) {
            citations.push(Citation {
                document_name,
                chunk_index: None,
                page_number: None,
                quote: None,
            });
        }
    }

    citations.sort_by(|a, b| a.document_name.cmp(&b.document_name));
    citations.dedup_by(|a, b| {
        a.document_name == b.document_name &&
        a.chunk_index == b.chunk_index &&
        a.page_number == b.page_number
    });

    MessageWithCitations {
        message: text.to_string(),
        citations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_citation_with_chunk() {
        let text = "According to [report.pdf] (chunk 3), revenue increased.";
        let result = parse_citations(text);
        assert_eq!(result.citations.len(), 1);
        assert_eq!(result.citations[0].document_name, "report.pdf");
        assert_eq!(result.citations[0].chunk_index, Some(3));
    }

    #[test]
    fn test_parse_citation_with_page() {
        let text = "According to [report.pdf] (page 5), costs decreased.";
        let result = parse_citations(text);
        assert_eq!(result.citations.len(), 1);
        assert_eq!(result.citations[0].document_name, "report.pdf");
        assert_eq!(result.citations[0].page_number, Some(5));
    }

    #[test]
    fn test_parse_multiple_citations() {
        let text = "According to [report.pdf] (chunk 1), revenue increased. According to [summary.txt] (chunk 2), costs decreased.";
        let result = parse_citations(text);
        assert_eq!(result.citations.len(), 2);
        assert_eq!(result.citations[0].document_name, "report.pdf");
        assert_eq!(result.citations[1].document_name, "summary.txt");
    }

    #[test]
    fn test_parse_bracket_only_citation() {
        let text = "The data from [analysis.pdf] shows improvement.";
        let result = parse_citations(text);
        assert_eq!(result.citations.len(), 1);
        assert_eq!(result.citations[0].document_name, "analysis.pdf");
    }

    #[test]
    fn test_no_citations() {
        let text = "This is a response with no citations.";
        let result = parse_citations(text);
        assert_eq!(result.citations.len(), 0);
    }
}
