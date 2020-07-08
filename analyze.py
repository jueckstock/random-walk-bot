#!/usr/bin/env python3
import csv
import json
import pprint
import sys
from collections import Counter
from urllib.parse import urlparse, parse_qsl


FIELD_NAMES = [
    "scheme",
    "netloc",
    "path",
    "params",
    "query",
    "fragment",
]


def main(argv):
    writer = csv.writer(sys.stdout, dialect="excel-tab", lineterminator="\n")

    added_field_counter = Counter()
    for json_file in argv[1:]:
        with open(json_file, "r", encoding="utf8") as fd:
            nav_data = json.load(fd)

        # distinct_clicked_urls = {record["clickedUrl"] for record in nav_data}
        # print(
        #    f"{json_file}\t{len(nav_data)}\t{len(distinct_clicked_urls)}",
        #    file=sys.stderr,
        # )

        if nav_data:
            seed_url = nav_data[0]["clickedUrl"]
            seed_bits = urlparse(seed_url)

            distinct_document_origins = {
                urlparse(record["documentUrl"]).netloc
                for record in nav_data
                if record["documentUrl"] != "START"
            }
            distinct_document_origins.add(seed_bits.netloc)
            for origin in distinct_document_origins:
                print(f"{json_file}\t{origin}", file=sys.stderr)

            for record in nav_data[1:]:
                click_url = record["clickedUrl"]
                click_bits = urlparse(click_url)
                doc_url = record["documentUrl"]
                doc_bits = urlparse(doc_url)
                for tab_id, nav_url_list in record["tabNavigations"].items():
                    if nav_url_list:
                        nav_url = nav_url_list[0]
                        nav_bits = urlparse(nav_url)

                        differing_fields = [
                            name
                            for i, name in enumerate(FIELD_NAMES)
                            if (click_bits[i] != nav_bits[i])
                        ] or ["="]

                        click_qsl = set(parse_qsl(click_bits.query)) | set(
                            parse_qsl(click_bits.fragment)
                        )
                        nav_qsl = set(parse_qsl(nav_bits.query)) | set(
                            parse_qsl(nav_bits.fragment)
                        )
                        new_fields = nav_qsl - click_qsl
                        new_field_score = sum(
                            10 + len(value) for _, value in new_fields
                        )

                        added_field_counter += Counter(k for k, _ in new_fields)

                        writer.writerow(
                            (
                                "/".join(differing_fields),
                                new_field_score,
                                seed_bits.netloc,
                                doc_bits.netloc,
                                click_url,
                                "same-tab" if tab_id == "clicked-tab" else "new-tab",
                                len(record["tabNavigations"]),
                                nav_url,
                                json_file,
                                # json.dumps(new_fields),
                                # len(nav_url_list),
                                # *nav_url_list,
                            )
                        )
    # print(json.dumps(added_field_counter), file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv)
