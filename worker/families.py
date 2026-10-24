"""The 15 career families shared by the career library, streams and Swadharma."""

FAMILIES = [
    "Engineering & Technology",
    "Medicine & Health",
    "Pure Sciences & Research",
    "Mathematics, Finance & Analytics",
    "Law & Governance",
    "Public Service & Defence",
    "Business, Management & Entrepreneurship",
    "Sales, Marketing & Media",
    "Arts, Design & Performance",
    "Writing, Communication & Languages",
    "Education & Counselling",
    "Social Work & Spirituality",
    "Agriculture, Environment & Earth",
    "Hospitality, Travel & Service",
    "Skilled Trades & Crafts",
]

# Typical RIASEC leaning of each family (R, I, A, S, E, C), used to compare a
# candidate's interest vector with the families a stream keeps open.
FAMILY_RIASEC = {
    "Engineering & Technology": [0.8, 0.9, 0.3, 0.2, 0.3, 0.6],
    "Medicine & Health": [0.5, 0.9, 0.2, 0.8, 0.3, 0.4],
    "Pure Sciences & Research": [0.5, 1.0, 0.5, 0.2, 0.1, 0.4],
    "Mathematics, Finance & Analytics": [0.2, 0.8, 0.1, 0.2, 0.6, 0.9],
    "Law & Governance": [0.1, 0.7, 0.3, 0.6, 0.9, 0.5],
    "Public Service & Defence": [0.7, 0.5, 0.1, 0.7, 0.8, 0.6],
    "Business, Management & Entrepreneurship": [0.3, 0.5, 0.4, 0.5, 1.0, 0.6],
    "Sales, Marketing & Media": [0.1, 0.4, 0.7, 0.5, 0.9, 0.4],
    "Arts, Design & Performance": [0.3, 0.5, 1.0, 0.4, 0.4, 0.2],
    "Writing, Communication & Languages": [0.1, 0.6, 0.9, 0.6, 0.6, 0.3],
    "Education & Counselling": [0.2, 0.6, 0.5, 1.0, 0.5, 0.4],
    "Social Work & Spirituality": [0.2, 0.5, 0.5, 1.0, 0.6, 0.3],
    "Agriculture, Environment & Earth": [0.9, 0.8, 0.2, 0.4, 0.3, 0.4],
    "Hospitality, Travel & Service": [0.4, 0.2, 0.4, 0.8, 0.8, 0.6],
    "Skilled Trades & Crafts": [1.0, 0.4, 0.4, 0.2, 0.3, 0.6],
}

BAND_RANK = {"Low": 0, "Average": 1, "High": 2, "Very High": 3}
